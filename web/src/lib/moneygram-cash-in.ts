"use client";

import { cashInSalt, commitment, encryptNote, fromBE, toBE32 } from "./crypto";
import { accountPubkeys, type LocalAccount } from "./notes";
import { proveDeposit } from "./prover";
import {
  poolDeposit,
  type Signer,
  scanDeposits,
  transferUsdc,
  usdcBalance,
} from "./stellar";

export type ShieldCashInResult = {
  shieldingTransactionHash: string | null;
  transferTransactionHash: string | null;
  leafIndex: number;
  alreadyShielded: boolean;
};

export async function shieldVerifiedCashIn(options: {
  account: LocalAccount;
  olioSigner: Signer;
  privyUsdcSigner: Signer;
  settlementIdentity: string;
  amount: bigint;
}): Promise<ShieldCashInResult> {
  const { account, olioSigner, privyUsdcSigner, settlementIdentity, amount } =
    options;
  const { notePubkey, viewPubkey } = await accountPubkeys(account);
  const salt = cashInSalt(account.ownerSecret, settlementIdentity);
  const ownerPkField = fromBE(notePubkey);
  const note = toBE32(await commitment(amount, ownerPkField, salt));

  const existing = (await scanDeposits()).find((deposit) =>
    deposit.commitment.every((byte, index) => byte === note[index]),
  );
  if (existing) {
    return {
      shieldingTransactionHash: null,
      transferTransactionHash: null,
      leafIndex: existing.leafIndex,
      alreadyShielded: true,
    };
  }

  let transferTransactionHash: string | null = null;
  if ((await usdcBalance(privyUsdcSigner.address)) >= amount) {
    transferTransactionHash = await transferUsdc(
      privyUsdcSigner,
      olioSigner.address,
      amount,
    );
  } else {
    if ((await usdcBalance(olioSigner.address)) < amount) {
      throw new Error(
        "The verified USDC is not available in the recoverable Privy account.",
      );
    }
  }

  const { proof } = await proveDeposit({
    commitment: fromBE(note).toString(),
    amount: amount.toString(),
    ownerPk: ownerPkField.toString(),
    salt: salt.toString(),
  });
  const { ephemeralPk, ciphertext } = encryptNote(viewPubkey, amount, salt);
  const shielded = await poolDeposit(
    olioSigner,
    note,
    amount,
    proof,
    ephemeralPk,
    ciphertext,
  );
  const confirmed = (await scanDeposits()).some(
    (deposit) =>
      deposit.leafIndex === shielded.leafIndex &&
      deposit.commitment.every((byte, index) => byte === note[index]),
  );
  if (!confirmed) {
    throw new Error(
      "The shielding transaction succeeded but its commitment event is not indexed yet. Retry status shortly.",
    );
  }
  return {
    shieldingTransactionHash: shielded.txHash,
    transferTransactionHash,
    leafIndex: shielded.leafIndex,
    alreadyShielded: false,
  };
}
