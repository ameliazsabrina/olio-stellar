import { authorizeEntry, xdr } from "@stellar/stellar-sdk";
import { networkPassphrase, type Signer, server } from "../../lib/stellar";
import { api } from "../../trpc/client";
import { signPayerAuthEntry } from "./kit";

const b64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const AUTH_VALID_LEDGERS = 100;

const ED25519_SIG_LEN = 64;

export function kitSigner(address: string): Signer {
  return {
    address,
    signAuthEntries: async (entries) => {
      const { sequence } = await server.getLatestLedger();
      const validUntil = sequence + AUTH_VALID_LEDGERS;

      const out: string[] = [];
      for (const entry of entries) {
        if (entry.credentials().switch().name !== "sorobanCredentialsAddress") {
          out.push(entry.toXDR("base64"));
          continue;
        }

        const toSign = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
        toSign.credentials().address().signatureExpirationLedger(validUntil);
        const walletOut = b64ToBytes(
          await signPayerAuthEntry(toSign.toXDR("base64"), address),
        );

        let signed: xdr.SorobanAuthorizationEntry;
        if (walletOut.length === ED25519_SIG_LEN) {
          signed = await authorizeEntry(
            entry,
            async () => ({ signature: walletOut, publicKey: address }),
            validUntil,
            networkPassphrase,
          );
        } else {
          // Wallet returned a fully-signed authorization entry — use it directly.
          signed = xdr.SorobanAuthorizationEntry.fromXDR(
            walletOut as unknown as Buffer,
          );
        }
        out.push(signed.toXDR("base64"));
      }
      return out;
    },
    relaySoroban: async (func, auth) => {
      const res = await api.passkey.relaySoroban.mutate({ func, auth });
      return { hash: res.hash };
    },
  };
}
