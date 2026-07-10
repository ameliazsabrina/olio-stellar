// Client-side passkey (WebAuthn secp256r1) smart-wallet helpers. Wraps
// passkey-kit: create/connect a per-user smart-wallet contract, and build a
// Signer that signs Soroban auth entries with the passkey. Submission is
// sponsored server-side through the Channels relayer (tRPC `passkey.*`), so the
// user needs no XLM. Browser-only — call from client components.

import { hash, Keypair, Transaction, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { PasskeyKit } from "passkey-kit";
import type { AppRouter } from "../server/root";
import { networkPassphrase, rpcUrl, type Signer } from "./stellar";

const WASM_HASH = process.env.NEXT_PUBLIC_SMART_WALLET_WASM_HASH || "";
const KEY_ID_STORAGE = "olio.passkey.keyId";
const APP_NAME = "Olio";

// passkey-kit's launcher account (deployer + tx source of every smart wallet).
// The seed is a fixed public constant, so we can reconstruct it to re-sign after
// adjusting the fee.
const launcher = () => Keypair.fromRawEd25519Seed(hash(Buffer.from("kalepail")));

// passkey-kit builds the deploy tx with a large safety-buffer inclusion fee, but
// the Channels relayer rejects any tx whose fee exceeds resourceFee + 201
// ("Transaction fee must be equal to the resource fee"). Rewrite the fee field to
// resourceFee + 100 (min inclusion; fee 0 → TxMalformed), preserving the Soroban
// footprint, and re-sign with the launcher.
function capDeployFee(signedTxXdr: string): string {
  const env = xdr.TransactionEnvelope.fromXDR(signedTxXdr, "base64");
  const inner = env.v1().tx();
  const resourceFee = inner.ext().sorobanData().resourceFee().toBigInt();
  inner.fee(Number(resourceFee + 100n));
  env.v1().signatures([]);
  const rebuilt = new Transaction(env, networkPassphrase);
  rebuilt.sign(launcher());
  return rebuilt.toXDR();
}

export const passkeyConfigured = Boolean(WASM_HASH);

// Lazily import passkey-kit in the browser only. It pulls in
// @stellar/stellar-sdk/minimal, whose contract-bindings codegen does a runtime
// require('../../package.json') that breaks under SSR bundling — same reason
// stellar.ts dynamically imports the wallets-kit.
let _kit: Promise<PasskeyKit> | null = null;
function kit(): Promise<PasskeyKit> {
  if (!_kit) {
    _kit = (async () => {
      const { PasskeyKit } = await import("passkey-kit");
      return new PasskeyKit({
        rpcUrl,
        networkPassphrase,
        walletWasmHash: WASM_HASH,
        // The Channels relayer rejects a submitted envelope whose maxTime is
        // >60s out; keep the deploy tx's timebound well under that.
        timeoutInSeconds: 30,
      });
    })();
  }
  return _kit;
}

function trpc() {
  return createTRPCProxyClient<AppRouter>({
    links: [httpBatchLink({ url: "/api/trpc" })],
  });
}

export type PasskeyWallet = { contractId: string; keyId: string };

// Register a new passkey and deploy its smart-wallet contract (sponsored). The
// deploy is signed by passkey-kit's launcher account with source-account
// credentials, so it must be relayed as a full envelope (fee-bumped) rather than
// via func+auth — the channel-account func+auth mode rejects source-account creds.
export async function createPasskeyWallet(
  username: string,
): Promise<PasskeyWallet> {
  const { contractId, keyIdBase64, signedTx } = await (
    await kit()
  ).createWallet(APP_NAME, username);
  await trpc().passkey.deploy.mutate({ xdr: capDeployFee(signedTx.toXDR()) });
  await trpc().passkey.saveWallet.mutate({
    contractId,
    credentialId: keyIdBase64,
  });
  window.localStorage.setItem(KEY_ID_STORAGE, keyIdBase64);
  return { contractId, keyId: keyIdBase64 };
}

// Authenticate an existing passkey and resolve its smart-wallet contract id via
// the off-chain mirror (credentialId -> contractId).
export async function connectPasskeyWallet(): Promise<PasskeyWallet> {
  const stored = window.localStorage.getItem(KEY_ID_STORAGE) ?? undefined;
  const { contractId, keyIdBase64 } = await (await kit()).connectWallet({
    keyId: stored,
    getContractId: async (keyId) =>
      (await trpc().passkey.walletByCredential.query({ credentialId: keyId }))
        ?.contractId,
  });
  window.localStorage.setItem(KEY_ID_STORAGE, keyIdBase64);
  return { contractId, keyId: keyIdBase64 };
}

export function passkeySigner(wallet: PasskeyWallet): Signer {
  return {
    address: wallet.contractId,
    signAuthEntries: async (entries) => {
      const k = await kit();
      // passkey-kit uses @stellar/stellar-sdk/minimal, a SEPARATELY-bundled
      // js-xdr. Live xdr objects can't cross that boundary (its writer rejects
      // our Hyper nonce), so hand entries over as bytes: re-parse each with the
      // minimal xdr, sign, and return base64 the relayer can submit as-is.
      const { xdr: mxdr } = await import("@stellar/stellar-sdk/minimal");
      const out: string[] = [];
      for (const entry of entries) {
        const minEntry = mxdr.SorobanAuthorizationEntry.fromXDR(
          entry.toXDR("base64"),
          "base64",
        );
        const s = await k.signAuthEntry(minEntry as never, {
          keyId: wallet.keyId,
        });
        out.push(s.toXDR("base64"));
      }
      return out;
    },
    relaySoroban: async (func, auth) => {
      const res = await trpc().passkey.relaySoroban.mutate({ func, auth });
      return { hash: res.hash };
    },
  };
}
