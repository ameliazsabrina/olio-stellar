import { Keypair, Transaction, xdr } from "@stellar/stellar-sdk";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { PasskeyKit } from "passkey-kit";
import type { AppRouter } from "../server/root";
import { networkPassphrase, rpcUrl, type Signer } from "./stellar";

const WASM_HASH = process.env.NEXT_PUBLIC_SMART_WALLET_WASM_HASH || "";
const KEY_ID_STORAGE = "olio.passkey.keyId";
const APP_NAME = "Olio";
const LAUNCHER_SEED = new Uint8Array([
  40, 96, 128, 206, 247, 45, 158, 82, 65, 38, 70, 171, 1, 143, 40, 67, 231, 33,
  60, 177, 174, 164, 110, 127, 219, 80, 162, 72, 83, 207, 75, 53,
]);

const launcher = () =>
  Keypair.fromRawEd25519Seed(LAUNCHER_SEED as unknown as Buffer);

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

let _kit: Promise<PasskeyKit> | null = null;
function kit(): Promise<PasskeyKit> {
  if (!_kit) {
    _kit = (async () => {
      const { PasskeyKit } = await import("passkey-kit");
      return new PasskeyKit({
        rpcUrl,
        networkPassphrase,
        walletWasmHash: WASM_HASH,

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

function storedKeyId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(KEY_ID_STORAGE) ?? undefined;
}

function rememberKeyId(keyId: string): void {
  window.localStorage.setItem(KEY_ID_STORAGE, keyId);
}

export function forgetPasskeyWallet(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_ID_STORAGE);
}

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
  rememberKeyId(keyIdBase64);
  return { contractId, keyId: keyIdBase64 };
}

export async function restorePasskeyWallet(): Promise<PasskeyWallet | null> {
  const keyId = storedKeyId();
  if (!keyId) return null;
  const wallet = await trpc().passkey.walletByCredential.query({
    credentialId: keyId,
  });
  if (!wallet?.contractId) {
    forgetPasskeyWallet();
    return null;
  }
  return { contractId: wallet.contractId, keyId: wallet.credentialId };
}

export async function connectPasskeyWallet(): Promise<PasskeyWallet> {
  const stored = storedKeyId();
  const { contractId, keyIdBase64 } = await (
    await kit()
  ).connectWallet({
    keyId: stored,
    getContractId: async (keyId) =>
      (await trpc().passkey.walletByCredential.query({ credentialId: keyId }))
        ?.contractId,
  });
  rememberKeyId(keyIdBase64);
  return { contractId, keyId: keyIdBase64 };
}

export function passkeySigner(wallet: PasskeyWallet): Signer {
  return {
    address: wallet.contractId,
    signAuthEntries: async (entries) => {
      const k = await kit();
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
