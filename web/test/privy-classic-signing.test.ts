import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { expect, it, vi } from "vitest";
import { signClassicTransaction } from "../src/lib/privy-wallet";

it("signs a classic Stellar transaction with the Privy raw-hash signer", async () => {
  const wallet = Keypair.random();
  const transaction = new TransactionBuilder(
    new Account(wallet.publicKey(), "1"),
    { fee: "100", networkPassphrase: Networks.TESTNET },
  )
    .addOperation(Operation.manageData({ name: "test", value: "value" }))
    .setTimeout(60)
    .build();
  const signRawHash = vi.fn(async ({ hash }: { hash: `0x${string}` }) => ({
    signature:
      `0x${Buffer.from(wallet.sign(Buffer.from(hash.slice(2), "hex"))).toString("hex")}` as `0x${string}`,
  }));
  const signedXdr = await signClassicTransaction({
    wallet: { id: "wallet-1", address: wallet.publicKey() },
    transactionXdr: transaction.toXDR(),
    networkPassphrase: Networks.TESTNET,
    signRawHash,
  });
  const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  expect(signed.signatures).toHaveLength(1);
  expect(signRawHash).toHaveBeenCalledOnce();
});
