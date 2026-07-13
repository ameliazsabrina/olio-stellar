"use client";

import {
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { type AnchorInfo, friendbotUrl, horizon, offRampAsset } from "./anchor";
import type { LocalAccount, MyNote, ScanResult } from "./notes";
import { networkPassphrase, type Signer } from "./stellar";
import { withdrawNote } from "./withdraw";

// The off-ramp uses a fresh, single-use classic "bridge" account, because the
// SDF anchor's SEP-10 auth targets classic G-accounts (SEP-45 web-auth for
// contract accounts is still Draft) and a SEP-24 withdrawal is matched by a
// classic payment + memo — neither of which a passkey smart-wallet contract can
// produce. The zk-withdraw releases the note into the bridge (breaking the link
// to the funding payment), and the bridge forwards it to the anchor. A new
// account per off-ramp also avoids reuse linkage.
export type Bridge = {
  keypair: Keypair;
  publicKey: string;
};

export function createBridge(): Bridge {
  const keypair = Keypair.random();
  return { keypair, publicKey: keypair.publicKey() };
}

/// Fund the bridge with XLM (testnet friendbot) and open a trustline to the
/// off-ramp asset so the SAC withdraw can credit it. On mainnet, friendbot is
/// absent — a sponsor/fee-bump must seed the account instead (see README).
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

/// zk-withdraw the selected note out of the shielded pool to the bridge account.
export async function releaseNoteToBridge(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  bridge: Bridge;
}): Promise<void> {
  const { signer, acct, scan, note, bridge } = params;
  await withdrawNote({
    signer,
    acct,
    scan,
    note,
    destination: bridge.publicKey,
  });
}

export type { AnchorInfo };
