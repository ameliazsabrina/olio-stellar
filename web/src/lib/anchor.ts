"use client";

import {
  Asset,
  Horizon,
  type Keypair,
  Memo,
  Operation,
  StellarToml,
  TransactionBuilder,
  WebAuth,
} from "@stellar/stellar-sdk";
import { networkPassphrase } from "./stellar";

// --- config -----------------------------------------------------------------
// The off-ramp is anchor-agnostic: everything is discovered from the anchor's
// SEP-1 stellar.toml at the configured home domain. Testnet defaults point at
// the SDF reference anchor, whose USDC issuer happens to match our pool asset
// (see NEXT_PUBLIC_USDC_ISSUER), so a withdrawal settles end-to-end on testnet.
export const anchorHomeDomain = (
  process.env.NEXT_PUBLIC_SEP24_ANCHOR_URL || "https://testanchor.stellar.org"
).replace(/\/+$/, "");
export const offRampAssetCode =
  process.env.NEXT_PUBLIC_SEP24_ASSET_CODE || "USDC";
export const offRampAssetIssuer = process.env.NEXT_PUBLIC_USDC_ISSUER || "";
export const horizonUrl =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";
export const friendbotUrl =
  process.env.NEXT_PUBLIC_FRIENDBOT_URL || "https://friendbot.stellar.org";

export const offRampEnabled = Boolean(anchorHomeDomain && offRampAssetIssuer);

export const horizon = new Horizon.Server(horizonUrl, {
  allowHttp: horizonUrl.startsWith("http://"),
});

export function offRampAsset(): Asset {
  return new Asset(offRampAssetCode, offRampAssetIssuer);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- SEP-1: anchor discovery ------------------------------------------------

export type AnchorInfo = {
  homeDomain: string;
  webAuthEndpoint: string;
  transferServer: string;
  signingKey: string;
};

/// Resolve the anchor's SEP-1 metadata and assert it advertises the endpoints
/// SEP-10 + SEP-24 require. `NETWORK_PASSPHRASE` on the anchor must match ours.
export async function fetchAnchorInfo(
  homeDomain = anchorHomeDomain,
): Promise<AnchorInfo> {
  const domain = homeDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const toml = await StellarToml.Resolver.resolve(domain, {
    allowHttp: horizonUrl.startsWith("http://"),
  });

  const webAuthEndpoint = toml.WEB_AUTH_ENDPOINT;
  const transferServer = toml.TRANSFER_SERVER_SEP0024;
  const signingKey = toml.SIGNING_KEY;
  if (!webAuthEndpoint || !transferServer || !signingKey) {
    throw new Error("Anchor does not support the SEP-24 off-ramp.");
  }
  if (
    toml.NETWORK_PASSPHRASE &&
    toml.NETWORK_PASSPHRASE !== networkPassphrase
  ) {
    throw new Error("Anchor is on a different Stellar network.");
  }
  return {
    homeDomain: domain,
    webAuthEndpoint: webAuthEndpoint.replace(/\/+$/, ""),
    transferServer: transferServer.replace(/\/+$/, ""),
    signingKey,
  };
}

// --- SEP-10: web authentication ---------------------------------------------

/// Run the full SEP-10 challenge/response and return a session JWT bound to
/// `account`. The challenge is validated (server signature + structure) before
/// we sign, so a spoofed endpoint can't get us to sign an arbitrary tx.
export async function authenticate(
  info: AnchorInfo,
  account: Keypair,
): Promise<string> {
  const url = new URL(info.webAuthEndpoint);
  url.searchParams.set("account", account.publicKey());
  url.searchParams.set("home_domain", info.homeDomain);

  const challengeRes = await fetch(url.toString());
  if (!challengeRes.ok) {
    throw new Error(`SEP-10 challenge failed (${challengeRes.status}).`);
  }
  const { transaction, network_passphrase } = (await challengeRes.json()) as {
    transaction: string;
    network_passphrase?: string;
  };
  const passphrase = network_passphrase || networkPassphrase;
  const webAuthDomain = new URL(info.webAuthEndpoint).host;

  // Validate the challenge came from the anchor's signing key, matches the
  // advertised home/web-auth domains, and targets our account before signing.
  const { tx, clientAccountID } = WebAuth.readChallengeTx(
    transaction,
    info.signingKey,
    passphrase,
    [info.homeDomain],
    webAuthDomain,
  );
  if (clientAccountID !== account.publicKey()) {
    throw new Error("SEP-10 challenge is for a different account.");
  }

  tx.sign(account);

  const tokenRes = await fetch(info.webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: tx.toXDR() }),
  });
  if (!tokenRes.ok) {
    throw new Error(`SEP-10 token exchange failed (${tokenRes.status}).`);
  }
  const { token } = (await tokenRes.json()) as { token?: string };
  if (!token) throw new Error("Anchor returned no session token.");
  return token;
}

// --- SEP-24: interactive withdraw -------------------------------------------

export type Sep24Transaction = {
  id: string;
  status: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: "text" | "id" | "hash";
  more_info_url?: string;
  message?: string;
};

export type InteractiveWithdraw = { id: string; url: string };

/// Kick off an interactive SEP-24 withdrawal. The anchor returns a hosted URL
/// where the user completes KYC and enters bank details — none of which ever
/// touches our servers.
export async function startInteractiveWithdraw(
  info: AnchorInfo,
  token: string,
  account: string,
  amount: string,
): Promise<InteractiveWithdraw> {
  const res = await fetch(
    `${info.transferServer}/transactions/withdraw/interactive`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        asset_code: offRampAssetCode,
        account,
        amount,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Anchor rejected the withdrawal (${res.status}).`);
  }
  const json = (await res.json()) as { id?: string; url?: string };
  if (!json.id || !json.url) {
    throw new Error("Anchor did not return an interactive URL.");
  }
  return { id: json.id, url: json.url };
}

export async function getSep24Transaction(
  info: AnchorInfo,
  token: string,
  id: string,
): Promise<Sep24Transaction> {
  const res = await fetch(`${info.transferServer}/transaction?id=${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Could not read withdrawal status (${res.status}).`);
  }
  const { transaction } = (await res.json()) as {
    transaction: Sep24Transaction;
  };
  return transaction;
}

/// Poll until the transaction reaches one of `until` statuses (or a terminal
/// error/expiry). Returns the last observed transaction.
export async function pollSep24Until(
  info: AnchorInfo,
  token: string,
  id: string,
  until: (tx: Sep24Transaction) => boolean,
  { intervalMs = 3000, timeoutMs = 15 * 60_000 } = {},
): Promise<Sep24Transaction> {
  const deadline = Date.now() + timeoutMs;
  let tx = await getSep24Transaction(info, token, id);
  while (!until(tx) && Date.now() < deadline) {
    if (tx.status === "error" || tx.status === "expired") {
      throw new Error(tx.message || `Withdrawal ${tx.status}.`);
    }
    await sleep(intervalMs);
    tx = await getSep24Transaction(info, token, id);
  }
  return tx;
}

// --- classic settlement payment ---------------------------------------------

function buildMemo(tx: Sep24Transaction): Memo | undefined {
  if (!tx.withdraw_memo) return undefined;
  switch (tx.withdraw_memo_type) {
    case "id":
      return Memo.id(tx.withdraw_memo);
    case "hash":
      return Memo.hash(Buffer.from(tx.withdraw_memo, "base64"));
    default:
      return Memo.text(tx.withdraw_memo);
  }
}

/// Send `amount_in` of the asset from the bridge account to the anchor's
/// withdraw account with the required memo — the on-chain leg that funds the
/// fiat payout.
export async function sendWithdrawalPayment(
  bridge: Keypair,
  tx: Sep24Transaction,
): Promise<string> {
  if (!tx.withdraw_anchor_account || !tx.amount_in) {
    throw new Error("Anchor did not provide payment instructions.");
  }
  const source = await horizon.loadAccount(bridge.publicKey());
  const fee = (await horizon.fetchBaseFee()).toString();
  const builder = new TransactionBuilder(source, {
    fee,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: tx.withdraw_anchor_account,
        asset: offRampAsset(),
        amount: tx.amount_in,
      }),
    )
    .setTimeout(120);
  const memo = buildMemo(tx);
  if (memo) builder.addMemo(memo);
  const payment = builder.build();
  payment.sign(bridge);
  const res = await horizon.submitTransaction(payment);
  return res.hash;
}
