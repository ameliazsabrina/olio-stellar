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

// --- stranded-fund recovery net ---------------------------------------------
// The bridge holds the withdrawn USDC for the brief window between releasing the
// note and settling to the anchor. Its key is otherwise in-memory only, so a
// crash/close in that window would strand the funds forever. We persist the
// secret (keyed by the SEP-24 transaction id) right before releasing and clear
// it once the withdrawal completes, so an interrupted off-ramp is recoverable.
const BRIDGE_STORE_PREFIX = "olio.offramp.bridge.";

export type StrandedBridge = {
  ref: string;
  secret: string;
  publicKey: string;
  amount: string;
  at: number;
};

export function persistBridge(
  bridge: Bridge,
  ref: string,
  amount: bigint,
): void {
  if (typeof localStorage === "undefined") return;
  const record: StrandedBridge = {
    ref,
    secret: bridge.keypair.secret(),
    publicKey: bridge.publicKey,
    amount: amount.toString(),
    at: Date.now(),
  };
  try {
    localStorage.setItem(BRIDGE_STORE_PREFIX + ref, JSON.stringify(record));
  } catch {
    // Storage full/blocked — nothing we can safely do; the in-memory key still works this session.
  }
}

export function clearPersistedBridge(ref: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(BRIDGE_STORE_PREFIX + ref);
  } catch {}
}

/// Bridges that were funded but whose off-ramp never reached `completed` — their
/// USDC (and residual XLM) is still claimable with the persisted secret.
export function listStrandedBridges(): StrandedBridge[] {
  if (typeof localStorage === "undefined") return [];
  const out: StrandedBridge[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(BRIDGE_STORE_PREFIX)) continue;
    try {
      const rec = JSON.parse(localStorage.getItem(key) ?? "");
      if (rec?.secret && rec?.publicKey) out.push(rec as StrandedBridge);
    } catch {}
  }
  return out;
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
