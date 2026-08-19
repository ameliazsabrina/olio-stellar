// @vitest-environment node
import { Address, Keypair, Networks, StrKey, xdr } from "@stellar/stellar-sdk";

const wallet = Keypair.random();
const olioAddress = StrKey.encodeContract(Buffer.alloc(32, 9));
const contracts = vi.hoisted(() => ({
  registry: "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
  pool: "CABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAFNSZ",
  usdc: "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3",
}));
const mocks = vi.hoisted(() => ({
  relay: vi.fn(async () => ({ hash: "tx-hash", status: "SUCCESS" })),
}));

vi.mock("../src/lib/stellar", () => ({
  networkPassphrase: Networks.TESTNET,
  registryId: contracts.registry,
  poolId: contracts.pool,
  usdcSacId: contracts.usdc,
  server: { getLatestLedger: async () => ({ sequence: 100 }) },
}));
vi.mock("../src/trpc/client", () => ({
  api: { channels: { relaySoroban: { mutate: mocks.relay } } },
}));

import { privySigner } from "../src/lib/privy-wallet";

function entry(contractId = contracts.registry, method = "register") {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(olioAddress).toScAddress(),
        nonce: new xdr.Int64(1),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function:
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: method,
            args: [],
          }),
        ),
      subInvocations: [],
    }),
  });
}

const signer = privySigner({
  olioAddress,
  wallet: { id: "wallet-1", address: wallet.publicKey() },
  signRawHash: async ({ hash: digestHex }) => ({
    signature: `0x${wallet.sign(Buffer.from(digestHex.slice(2), "hex")).toString("hex")}`,
  }),
});

describe("privySigner", () => {
  it("pins expiration and encodes a verified Ed25519 signature", async () => {
    const [encoded] = await signer.signAuthEntries([entry()]);
    const signed = xdr.SorobanAuthorizationEntry.fromXDR(encoded, "base64");
    expect(signed.credentials().address().signatureExpirationLedger()).toBe(
      160,
    );
    expect(signed.credentials().address().signature().switch().name).not.toBe(
      "scvVoid",
    );
  });

  it("rejects a contract outside the Olio allowlist before calling Privy", async () => {
    const unknown = StrKey.encodeContract(Buffer.alloc(32, 7));
    await expect(signer.signAuthEntries([entry(unknown)])).rejects.toThrow(
      /non-allowlisted invocation/,
    );
  });
});
