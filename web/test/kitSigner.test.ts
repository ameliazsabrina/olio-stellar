// @vitest-environment node

import {
  Address,
  hash,
  Keypair,
  Networks,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The payer's keypair — the mock wallet signs auth-entry preimages with it, so
// authorizeEntry's real signature verification inside kitSigner must pass.
const kp = Keypair.random();

const LATEST_LEDGER = 1000;
const mocks = vi.hoisted(() => ({
  capturedExpiration: null as number | null,
  relayMutate: vi.fn(async () => ({ hash: "beef", status: "SUCCESS" })),
}));

vi.mock("../src/lib/stellar", () => ({
  networkPassphrase: Networks.TESTNET,
  server: { getLatestLedger: async () => ({ sequence: LATEST_LEDGER }) },
}));

vi.mock("../src/trpc/client", () => ({
  api: { passkey: { relaySoroban: { mutate: mocks.relayMutate } } },
}));

// Mock wallet: it's handed a base64 HashIdPreimage (exactly what Freighter's
// signAuthEntry receives), records the pinned expiration, and returns the raw
// ed25519 signature over sha256(preimage) — what Freighter returns.
vi.mock("../src/features/payerWallet/kit", () => ({
  signPayerAuthEntry: vi.fn(async (preimageXdr: string) => {
    const preimage = xdr.HashIdPreimage.fromXDR(preimageXdr, "base64");
    mocks.capturedExpiration = preimage
      .sorobanAuthorization()
      .signatureExpirationLedger();
    return kp.sign(hash(preimage.toXDR())).toString("base64");
  }),
}));

import { kitSigner } from "../src/features/payerWallet/kitSigner";

// A simulation-style auth entry: address credentials for the payer, expiration 0.
function unsignedEntry(): xdr.SorobanAuthorizationEntry {
  const contractId = StrKey.encodeContract(Buffer.alloc(32));
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(kp.publicKey()).toScAddress(),
        nonce: new xdr.Int64(42),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: "deposit",
            args: [],
          }),
        ),
      subInvocations: [],
    }),
  });
}

beforeEach(() => {
  mocks.capturedExpiration = null;
  mocks.relayMutate.mockClear();
});

describe("kitSigner.signAuthEntries", () => {
  it("pins a non-zero expiration and returns a wallet-signed entry", async () => {
    const [signedB64] = await kitSigner(kp.publicKey()).signAuthEntries([
      unsignedEntry(),
    ]);

    // The wallet was asked to sign against a real (latest + window) expiration,
    // not the simulation's 0 — otherwise the relayer would reject it.
    expect(mocks.capturedExpiration).toBe(LATEST_LEDGER + 100);

    // Output is a valid entry whose address credential now carries a signature
    // (authorizeEntry verified it against the payload before assembling it).
    const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedB64, "base64");
    const sig = signed.credentials().address().signature();
    expect(sig.switch()).not.toBe(xdr.ScValType.scvVoid());
    expect(signed.credentials().address().signatureExpirationLedger()).toBe(
      LATEST_LEDGER + 100,
    );
  });
});

describe("kitSigner.relaySoroban", () => {
  it("forwards the func + auth to the Channels relayer", async () => {
    const res = await kitSigner(kp.publicKey()).relaySoroban("func-xdr", [
      "auth-xdr",
    ]);
    expect(mocks.relayMutate).toHaveBeenCalledWith({
      func: "func-xdr",
      auth: ["auth-xdr"],
    });
    expect(res).toEqual({ hash: "beef" });
  });
});
