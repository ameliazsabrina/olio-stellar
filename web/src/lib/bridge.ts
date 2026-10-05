"use client";

import {
  BASE_FEE,
  Claimant,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { api } from "../trpc/client";
import { friendbotUrl, horizon, offRampAsset } from "./stellar-payments";
import { fromBaseUnits, toBaseUnits } from "./crypto";
import type { LocalAccount, MyNote, ScanResult } from "./notes";
import { isMainnet, networkPassphrase, type Signer } from "./stellar";
import { withdrawNote } from "./withdraw";

export type Bridge = {
  keypair: Keypair;
  publicKey: string;
};

export function createBridge(): Bridge {
  const keypair = Keypair.random();
  return { keypair, publicKey: keypair.publicKey() };
}

const BRIDGE_STORE_PREFIX = "olio.offramp.bridge.";
// Read-only compatibility for recovering pre-retirement bridge keys.
const RAMP_SESSION_PREFIX = "olio.moneygram.ramp.v1.";

export type RampFlowKind = "cash-out" | "cash-in";
export type RampSession = {
  version: 1 | 2;
  ref: string;
  mgiId: string;
  kind: RampFlowKind;
  secret?: string;
  publicKey: string;
  amount: string;
  status: string;
  createdAt: number;
  updatedAt: number;
};

export type StrandedBridge = {
  ref: string;
  secret: string;
  publicKey: string;
  amount: string;
  destination?: string;
  at: number;
};

export function listRampSessions(): RampSession[] {
  if (typeof localStorage === "undefined") return [];
  const sessions: RampSession[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(RAMP_SESSION_PREFIX)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "") as RampSession;
      if (
        (value.version === 1 || value.version === 2) &&
        value.publicKey &&
        value.mgiId
      )
        sessions.push(value);
    } catch {}
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function persistBridge(
  bridge: Bridge,
  ref: string,
  amount: bigint,
  destination?: string,
): void {
  if (typeof localStorage === "undefined") return;
  const record: StrandedBridge = {
    ref,
    secret: bridge.keypair.secret(),
    publicKey: bridge.publicKey,
    amount: amount.toString(),
    destination,
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
    const key = RAMP_SESSION_PREFIX + ref;
    const raw = localStorage.getItem(key);
    if (raw) {
      const session = JSON.parse(raw) as RampSession;
      const { secret: _secret, ...evidence } = session;
      localStorage.setItem(
        key,
        JSON.stringify({ ...evidence, updatedAt: Date.now() }),
      );
    }
    window.dispatchEvent(new Event("olio:ramp-session"));
  } catch {}
}

export function dismissRampSession(ref: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(RAMP_SESSION_PREFIX + ref);
    window.dispatchEvent(new Event("olio:ramp-session"));
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
  for (const session of listRampSessions()) {
    if (!session.secret) continue;
    out.push({
      ref: session.ref,
      secret: session.secret,
      publicKey: session.publicKey,
      amount: session.amount,
      at: session.createdAt,
    });
  }
  return out;
}

// Fund the bridge and open its USDC trustline.
export async function provisionBridge(bridge: Bridge): Promise<void> {
  if (isMainnet) {
    await api.bridge.fund.mutate({ bridgePublicKey: bridge.publicKey });
  } else {
    const res = await fetch(
      `${friendbotUrl}?addr=${encodeURIComponent(bridge.publicKey)}`,
    );
    if (!res.ok && res.status !== 400) {
      // 400 == already funded; anything else is a real failure.
      throw new Error(`Could not fund the payout account (${res.status}).`);
    }
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

export async function releaseNoteToBridge(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  bridge: Bridge;
}): Promise<{ provingMs: number }> {
  const { signer, acct, scan, note, bridge } = params;
  const res = await withdrawNote({
    signer,
    acct,
    scan,
    note,
    destination: bridge.publicKey,
  });
  return { provingMs: res.provingMs };
}

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

export async function bridgeUsdcBalance(publicKey: string): Promise<bigint> {
  let account: Awaited<ReturnType<typeof horizon.loadAccount>>;
  try {
    account = await horizon.loadAccount(publicKey);
  } catch {
    return 0n;
  }
  const asset = offRampAsset();
  const held = account.balances.find(
    (b) =>
      b.asset_type !== "native" &&
      "asset_code" in b &&
      b.asset_code === asset.code &&
      b.asset_issuer === asset.issuer,
  );
  return held ? toBaseUnits(held.balance) : 0n;
}

export async function reclaimBridge(
  secret: string,
  destination: string,
): Promise<{ claimableBalanceId: string; amount: bigint }> {
  const keypair = Keypair.fromSecret(secret);
  const amount = await bridgeUsdcBalance(keypair.publicKey());
  if (amount === 0n) {
    throw new Error("This account no longer holds any USDC.");
  }
  const claimableBalanceId = await createClaimableBalanceToDestination(
    keypair,
    destination,
    amount,
  );
  return { claimableBalanceId, amount };
}
