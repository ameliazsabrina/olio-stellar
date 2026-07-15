"use client";

import {
  BASE_FEE,
  Claimant,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { friendbotUrl, horizon, offRampAsset } from "./anchor";
import { fromBaseUnits } from "./crypto";
import type { LocalAccount, MyNote, ScanResult } from "./notes";
import { networkPassphrase, type Signer } from "./stellar";
import { withdrawNote } from "./withdraw";

// Fresh single-use classic G-account for SEP-24 off-ramp and claimable-balance payouts; per-op to avoid reuse linkage.
export type Bridge = {
  keypair: Keypair;
  publicKey: string;
};

export function createBridge(): Bridge {
  const keypair = Keypair.random();
  return { keypair, publicKey: keypair.publicKey() };
}

// Fund the bridge (testnet friendbot) and open the USDC trustline; mainnet needs a sponsor instead (see README).
export async function provisionBridge(bridge: Bridge): Promise<void> {
  const res = await fetch(
    `${friendbotUrl}?addr=${encodeURIComponent(bridge.publicKey)}`,
  );
  if (!res.ok && res.status !== 400) {
    // 400 == already funded; anything else is a real failure.
    throw new Error(`Could not fund the payout account (${res.status}).`);
  }

  const account = await horizon.loadAccount(bridge.publicKey);
  const hasTrustline = account.balances.some(
    (b) =>
      b.asset_type !== "native" &&
      "asset_code" in b &&
      b.asset_code === offRampAsset().code &&
      b.asset_issuer === offRampAsset().issuer,
  );
  if (hasTrustline) return;

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: offRampAsset() }))
    .setTimeout(120)
    .build();
  tx.sign(bridge.keypair);
  await horizon.submitTransaction(tx);
}

// zk-withdraw the selected note out of the shielded pool to the bridge account.
export async function releaseNoteToBridge(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  bridge: Bridge;
}): Promise<{ provingMs: number }> {
  const { signer, acct, scan, note, bridge } = params;
  // Bridge already holds a USDC trustline, so this takes the direct proof-bound withdraw path.
  const res = await withdrawNote({
    signer,
    acct,
    scan,
    note,
    destination: bridge.publicKey,
  });
  return { provingMs: res.provingMs };
}

// createClaimableBalance from the bridge so a trustline-less G-account can claim later; retries once since the note is already spent.
export async function createClaimableBalanceToDestination(
  bridgeKp: Keypair,
  destination: string,
  amount: bigint,
): Promise<string> {
  const build = async (): Promise<string> => {
    const account = await horizon.loadAccount(bridgeKp.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        Operation.createClaimableBalance({
          asset: offRampAsset(),
          amount: fromBaseUnits(amount),
          claimants: [
            new Claimant(destination, Claimant.predicateUnconditional()),
          ],
        }),
      )
      .setTimeout(120)
      .build();
    tx.sign(bridgeKp);
    // Deterministic from source account + sequence, matching the ledger's assignment.
    const balanceId = tx.getClaimableBalanceId(0);
    await horizon.submitTransaction(tx);
    return balanceId;
  };

  try {
    return await build();
  } catch {
    // Rebuild against a fresh sequence number and try once more.
    return build();
  }
}
