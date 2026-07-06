// Client-side Privy helpers: fetch the user's server-managed Stellar wallet and
// build a Signer that signs Soroban tx hashes via tRPC (which calls Privy
// raw_sign server-side).

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { Buffer } from "buffer";
import { Keypair, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { AppRouter } from "../server/api/trpc";
import { networkPassphrase, type Signer } from "./stellar";

export type PrivyWallet = { address: string; walletId: string };

function trpc(accessToken: string) {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        headers: { Authorization: `Bearer ${accessToken}` }
      })
    ]
  });
}

export async function fetchPrivyWallet(accessToken: string): Promise<PrivyWallet> {
  return trpc(accessToken).privy.wallet.mutate();
}

export function privySigner(
  wallet: PrivyWallet,
  getAccessToken: () => Promise<string | null>
): Signer {
  return {
    address: wallet.address,
    sign: async (unsignedXdr: string) => {
      const tx = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);
      const hashHex = tx.hash().toString("hex");
      const token = await getAccessToken();
      if (!token) throw new Error("Not logged in to Privy.");

      const { signatureHex } = await trpc(token).privy.sign.mutate({
        walletId: wallet.walletId,
        hashHex
      });

      const signature = Buffer.from(signatureHex, "hex");
      const hint = Keypair.fromPublicKey(wallet.address).signatureHint();
      tx.signatures.push(new xdr.DecoratedSignature({ hint, signature }));
      return tx.toXDR();
    }
  };
}
