"use client";

import {
  Asset,
  BASE_FEE,
  Horizon,
  type Keypair,
  Memo,
  Operation,
  StellarToml,
  TransactionBuilder,
  WebAuth,
} from "@stellar/stellar-sdk";
import { env } from "../env";
import { api } from "../trpc/client";
import { fromBaseUnits, toBaseUnits } from "./crypto";
import { isMainnet, networkPassphrase } from "./stellar";

// --- config -----------------------------------------------------------------
// The off-ramp is anchor-agnostic: everything is discovered from the anchor's
// SEP-1 stellar.toml at the configured home domain. Testnet defaults point at
// the SDF reference anchor, whose USDC issuer happens to match our pool asset
// (see NEXT_PUBLIC_USDC_ISSUER), so a withdrawal settles end-to-end on testnet.
const configuredAnchorUrl = env.NEXT_PUBLIC_SEP24_ANCHOR_URL;
export const anchorHomeDomain = (
  configuredAnchorUrl === undefined
    ? isMainnet
      ? ""
      : "https://testanchor.stellar.org"
    : configuredAnchorUrl
).replace(/\/+$/, "");
export const offRampAssetCode = env.NEXT_PUBLIC_SEP24_ASSET_CODE;
export const offRampAssetIssuer = env.NEXT_PUBLIC_USDC_ISSUER || "";
export const sep10ClientDomain = (env.NEXT_PUBLIC_SEP10_CLIENT_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
export const horizonUrl = env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
const configuredFriendbotUrl = env.NEXT_PUBLIC_FRIENDBOT_URL;
export const friendbotUrl =
  configuredFriendbotUrl === undefined
    ? isMainnet
      ? ""
      : "https://friendbot.stellar.org"
    : configuredFriendbotUrl;

export const offRampEnabled = Boolean(
  anchorHomeDomain && offRampAssetIssuer && (!isMainnet || sep10ClientDomain),
);

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

function assertEndpointForDomain(endpoint: string, domain: string): void {
  const url = new URL(endpoint);
  if (url.hostname !== domain) {
    throw new Error("Anchor metadata points to a mismatched domain.");
  }
}

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
    throw new Error("Anchor does not support SEP-10 and SEP-24.");
  }
  assertEndpointForDomain(webAuthEndpoint, domain);
  assertEndpointForDomain(transferServer, domain);
  if (
    toml.NETWORK_PASSPHRASE &&
    toml.NETWORK_PASSPHRASE !== networkPassphrase
  ) {
    throw new Error("Anchor is on a different Stellar network.");
  }
  if (isMainnet) {
    const endpoints = [webAuthEndpoint, transferServer];
    if (
      !homeDomain.startsWith("https://") ||
      endpoints.some((endpoint) => !endpoint.startsWith("https://"))
    ) {
      throw new Error("Mainnet anchor endpoints must use HTTPS.");
    }
  }
  const supportsAsset = toml.CURRENCIES?.some(
    (currency) =>
      currency.code === offRampAssetCode &&
      currency.issuer === offRampAssetIssuer &&
      currency.status !== "dead",
  );
  if (!supportsAsset) {
    throw new Error(
      `Anchor does not advertise the configured ${offRampAssetCode} asset.`,
    );
  }
  return {
    homeDomain: domain,
    webAuthEndpoint: webAuthEndpoint.replace(/\/+$/, ""),
    transferServer: transferServer.replace(/\/+$/, ""),
    signingKey,
  };
}

export type Sep24AssetInfo = {
  enabled?: boolean;
  min_amount?: number;
  max_amount?: number;
};

export type Sep24Info = {
  deposit?: Record<string, Sep24AssetInfo>;
  withdraw?: Record<string, Sep24AssetInfo>;
};

export async function fetchSep24Info(info: AnchorInfo): Promise<Sep24Info> {
  const res = await fetch(`${info.transferServer}/info`);
  if (!res.ok) throw new Error(`Could not validate SEP-24 (${res.status}).`);
  return (await res.json()) as Sep24Info;
}

/** Fail-closed deployment/runtime preflight for the configured MoneyGram anchor. */
export async function validateAnchorPreflight(options?: {
  requireDeposit?: boolean;
}): Promise<{ info: AnchorInfo; sep24: Sep24Info }> {
  if (!anchorHomeDomain || !offRampAssetIssuer || !sep10ClientDomain) {
    throw new Error(
      "MoneyGram requires an anchor URL, USDC issuer, and allowlisted client domain.",
    );
  }
  const clientToml = await StellarToml.Resolver.resolve(sep10ClientDomain, {
    allowHttp: horizonUrl.startsWith("http://"),
  });
  if (
    !clientToml.SIGNING_KEY ||
    (clientToml.NETWORK_PASSPHRASE &&
      clientToml.NETWORK_PASSPHRASE !== networkPassphrase)
  ) {
    throw new Error(
      "The client domain does not advertise a signing key for this network.",
    );
  }
  const info = await fetchAnchorInfo();
  const sep24 = await fetchSep24Info(info);
  if (
    sep24.withdraw?.[offRampAssetCode]?.enabled === false ||
    !sep24.withdraw?.[offRampAssetCode]
  ) {
    throw new Error(`Anchor does not enable ${offRampAssetCode} withdrawals.`);
  }
  if (
    options?.requireDeposit &&
    (sep24.deposit?.[offRampAssetCode]?.enabled === false ||
      !sep24.deposit?.[offRampAssetCode])
  ) {
    throw new Error(`Anchor does not enable ${offRampAssetCode} deposits.`);
  }
  return { info, sep24 };
}

// --- SEP-10: web authentication ---------------------------------------------

/// Run the full SEP-10 challenge/response and return a session JWT bound to
/// `account`. The challenge is validated (server signature + structure) before
/// we sign, so a spoofed endpoint can't get us to sign an arbitrary tx.
export async function authenticate(
  info: AnchorInfo,
  signer: Sep10Signer | Keypair,
): Promise<string> {
  const account = sep10Signer(signer);
  const url = new URL(info.webAuthEndpoint);
  url.searchParams.set("account", account.publicKey);
  url.searchParams.set("home_domain", info.homeDomain);
  if (sep10ClientDomain) {
    url.searchParams.set("client_domain", sep10ClientDomain);
  }

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
  if (clientAccountID !== account.publicKey) {
    throw new Error("SEP-10 challenge is for a different account.");
  }

  const accountSignedXdr = await account.signTransactionXdr(
    tx.toXDR(),
    passphrase,
  );
  const signedTransaction = sep10ClientDomain
    ? (
        await api.anchor.signClientChallenge.mutate({
          transactionXdr: accountSignedXdr,
          accountPublicKey: account.publicKey,
          accountKind: account.kind,
        })
      ).signedTransactionXdr
    : accountSignedXdr;

  const tokenRes = await fetch(info.webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedTransaction }),
  });
  if (!tokenRes.ok) {
    throw new Error(`SEP-10 token exchange failed (${tokenRes.status}).`);
  }
  const { token } = (await tokenRes.json()) as { token?: string };
  if (!token) throw new Error("Anchor returned no session token.");
  return token;
}

export type Sep10Signer = {
  publicKey: string;
  kind: "cash-in" | "cash-out";
  signTransactionXdr: (
    transactionXdr: string,
    passphrase: string,
  ) => Promise<string>;
};

function sep10Signer(value: Sep10Signer | Keypair): Sep10Signer {
  if ("signTransactionXdr" in value) return value;
  return {
    publicKey: value.publicKey(),
    kind: "cash-out",
    signTransactionXdr: async (transactionXdr, passphrase) => {
      const tx = TransactionBuilder.fromXDR(transactionXdr, passphrase);
      tx.sign(value);
      return tx.toXDR();
    },
  };
}

// --- SEP-24: /info withdraw limits ------------------------------------------

export type WithdrawLimits = { min?: number; max?: number };

export async function fetchWithdrawLimits(
  info: AnchorInfo,
  assetCode = offRampAssetCode,
): Promise<WithdrawLimits> {
  try {
    const json = await fetchSep24Info(info);
    const entry = json.withdraw?.[assetCode];
    if (!entry || entry.enabled === false) return {};
    return { min: entry.min_amount, max: entry.max_amount };
  } catch {
    return {};
  }
}

// --- SEP-24: interactive withdraw -------------------------------------------

export type Sep24Status =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_external"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_trust"
  | "pending_user"
  | "pending_transaction_info_update"
  | "pending_customer_info_update"
  | "pending_receiver"
  | "completed"
  | "refunded"
  | "expired"
  | "no_market"
  | "too_small"
  | "too_large"
  | "error";

export type Sep24Refund = {
  id?: string;
  amount?: string;
  amount_fee?: string;
  status?: string;
  started_at?: string;
  completed_at?: string;
};

export type Sep24Transaction = {
  id: string;
  kind?: "deposit" | "withdrawal";
  status: Sep24Status;
  to?: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: "text" | "id" | "hash";
  deposit_memo?: string;
  deposit_memo_type?: "text" | "id" | "hash";
  external_transaction_id?: string;
  stellar_transaction_id?: string;
  more_info_url?: string;
  message?: string;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
  refunds?: {
    amount_refunded?: string;
    amount_fee?: string;
    payments?: Sep24Refund[];
  };
};

export type InteractiveTransaction = { id: string; url: string };

/// Kick off an interactive SEP-24 withdrawal. The anchor returns a hosted URL
/// where the user completes KYC and enters bank details — none of which ever
/// touches our servers.
export async function startInteractiveWithdraw(
  info: AnchorInfo,
  token: string,
  account: string,
  amount: string,
): Promise<InteractiveTransaction> {
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
        lang: "en",
        wallet_name: "Olio",
        wallet_url:
          typeof window === "undefined" ? undefined : window.location.origin,
        callback: "postMessage",
      }),
    },
  );
  if (!res.ok) {
    // The anchor returns a JSON `{ error }` explaining the rejection (e.g.
    // "amount exceeds asset's maximum limit: 20"). Surface it instead of the
    // bare status, which hides the one detail the user needs.
    const reason = await res
      .clone()
      .json()
      .then((b: { error?: string }) => b?.error)
      .catch(() => undefined);
    throw new Error(
      reason
        ? `Anchor rejected the withdrawal: ${reason}`
        : `Anchor rejected the withdrawal (${res.status}).`,
    );
  }
  const json = (await res.json()) as { id?: string; url?: string };
  if (!json.id || !json.url) {
    throw new Error("Anchor did not return an interactive URL.");
  }
  return { id: json.id, url: json.url };
}

export async function startInteractiveDeposit(
  info: AnchorInfo,
  token: string,
  account: string,
  amount: string,
): Promise<InteractiveTransaction> {
  const res = await fetch(
    `${info.transferServer}/transactions/deposit/interactive`,
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
        lang: "en",
        wallet_name: "Olio",
        wallet_url:
          typeof window === "undefined" ? undefined : window.location.origin,
        callback: "postMessage",
      }),
    },
  );
  if (!res.ok) {
    const reason = await res
      .clone()
      .json()
      .then((b: { error?: string }) => b?.error)
      .catch(() => undefined);
    throw new Error(
      reason
        ? `Anchor rejected the deposit: ${reason}`
        : `Anchor rejected the deposit (${res.status}).`,
    );
  }
  const json = (await res.json()) as { id?: string; url?: string };
  if (!json.id || !json.url)
    throw new Error("Anchor did not return an interactive URL.");
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
    throw new Error(`Could not read SEP-24 status (${res.status}).`);
  }
  const { transaction } = (await res.json()) as {
    transaction: Sep24Transaction;
  };
  return transaction;
}

const SEP24_FAILURE_STATUSES = new Set<Sep24Status>([
  "error",
  "expired",
  "no_market",
  "too_small",
  "too_large",
]);

export const SEP24_TERMINAL_SUCCESS_STATUSES = new Set<Sep24Status>([
  "completed",
  "refunded",
]);

export function isTrustedCommitResult(
  event: Pick<MessageEvent, "origin" | "data">,
  interactiveUrl: string,
  expectedId: string,
): boolean {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(interactiveUrl).origin;
  } catch {
    return false;
  }
  const data = event.data as {
    type?: unknown;
    payload?: {
      transaction?: Sep24Transaction;
      id?: string;
      status?: Sep24Status;
    };
    transaction?: Sep24Transaction;
  } | null;
  const transaction =
    data?.payload?.transaction ??
    data?.transaction ??
    (data?.payload?.id && data.payload.status
      ? ({
          id: data.payload.id,
          status: data.payload.status,
        } as Sep24Transaction)
      : undefined);
  return (
    event.origin === expectedOrigin &&
    data?.type === "COMMIT_RESULT" &&
    transaction?.id === expectedId &&
    typeof transaction?.status === "string"
  );
}

export async function listSep24Transactions(
  info: AnchorInfo,
  token: string,
  account: string,
): Promise<Sep24Transaction[]> {
  const url = new URL(`${info.transferServer}/transactions`);
  url.searchParams.set("asset_code", offRampAssetCode);
  url.searchParams.set("account", account);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(`Could not recover SEP-24 history (${res.status}).`);
  const body = (await res.json()) as { transactions?: Sep24Transaction[] };
  return body.transactions ?? [];
}

export type VerifiedInboundPayment = {
  transactionHash: string;
  operationId: string;
  amount: bigint;
  amountDecimal: string;
};

/** Verify the anchor's claimed settlement against Horizon before shielding. */
export async function verifyInboundUsdcPayment(
  account: string,
  tx: Sep24Transaction,
): Promise<VerifiedInboundPayment> {
  if (!tx.stellar_transaction_id) {
    throw new Error("MoneyGram has not published a Stellar settlement yet.");
  }
  if (tx.deposit_memo) {
    const stellarTx = await horizon
      .transactions()
      .transaction(tx.stellar_transaction_id)
      .call();
    if (
      stellarTx.memo !== tx.deposit_memo ||
      (tx.deposit_memo_type && stellarTx.memo_type !== tx.deposit_memo_type)
    ) {
      throw new Error(
        "The MoneyGram Stellar transaction memo does not match the SEP-24 deposit.",
      );
    }
  }
  const page = await horizon
    .payments()
    .forTransaction(tx.stellar_transaction_id)
    .limit(200)
    .call();
  const payments = page.records.filter((record) => {
    const row = record as unknown as Record<string, unknown>;
    return (
      row.type === "payment" &&
      row.to === account &&
      row.asset_code === offRampAssetCode &&
      row.asset_issuer === offRampAssetIssuer &&
      typeof row.amount === "string"
    );
  }) as unknown as Array<{ id: string; amount: string }>;
  if (payments.length === 0) {
    throw new Error(
      "The MoneyGram Stellar transaction did not pay the configured USDC to this wallet.",
    );
  }
  const amount = payments.reduce(
    (total, payment) => total + toBaseUnits(payment.amount),
    0n,
  );
  if (amount <= 0n)
    throw new Error("MoneyGram reported an empty USDC payment.");
  return {
    transactionHash: tx.stellar_transaction_id,
    operationId: payments.map((payment) => payment.id).join(","),
    amount,
    amountDecimal: fromBaseUnits(amount),
  };
}

export type ClassicTransactionSigner = (
  transactionXdr: string,
  passphrase: string,
) => Promise<string>;

/** Funded user G-account trustline setup; safe to call repeatedly. */
export async function ensureUsdcTrustline(
  account: string,
  signTransaction: ClassicTransactionSigner,
): Promise<string | null> {
  const source = await horizon.loadAccount(account);
  const asset = offRampAsset();
  const exists = source.balances.some(
    (balance) =>
      balance.asset_type !== "native" &&
      "asset_code" in balance &&
      balance.asset_code === asset.code &&
      balance.asset_issuer === asset.issuer,
  );
  if (exists) return null;
  const fee = String(await horizon.fetchBaseFee());
  const transaction = new TransactionBuilder(source, {
    fee: fee || BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(120)
    .build();
  const signed = TransactionBuilder.fromXDR(
    await signTransaction(transaction.toXDR(), networkPassphrase),
    networkPassphrase,
  );
  const submitted = await horizon.submitTransaction(signed);
  return submitted.hash;
}

export class Sep24PollTimeoutError extends Error {
  constructor(
    message: string,
    public readonly lastTransaction: Sep24Transaction,
  ) {
    super(message);
    this.name = "Sep24PollTimeoutError";
  }
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
  while (!until(tx)) {
    if (SEP24_FAILURE_STATUSES.has(tx.status)) {
      throw new Error(
        tx.message || `Withdrawal cannot continue (${tx.status}).`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Sep24PollTimeoutError(
        "Timed out waiting for the anchor. Reopen the withdrawal and check its status.",
        tx,
      );
    }
    await sleep(intervalMs);
    tx = await getSep24Transaction(info, token, id);
  }
  return tx;
}

// --- classic settlement payment ---------------------------------------------

export function buildMemoFrom(
  value?: string,
  type?: "text" | "id" | "hash",
): Memo | undefined {
  if (!value) return undefined;
  switch (type) {
    case "id":
      return Memo.id(value);
    case "hash":
      return Memo.hash(Buffer.from(value, "base64"));
    default:
      return Memo.text(value);
  }
}

function buildMemo(tx: Sep24Transaction): Memo | undefined {
  return buildMemoFrom(tx.withdraw_memo, tx.withdraw_memo_type);
}

export async function sendUsdcPayment(
  bridge: Keypair,
  {
    destination,
    amount,
    memo,
  }: { destination: string; amount: string; memo?: Memo },
): Promise<string> {
  const source = await horizon.loadAccount(bridge.publicKey());
  const fee = (await horizon.fetchBaseFee()).toString();
  const builder = new TransactionBuilder(source, {
    fee,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: offRampAsset(),
        amount,
      }),
    )
    .setTimeout(120);
  if (memo) builder.addMemo(memo);
  const payment = builder.build();
  payment.sign(bridge);
  const res = await horizon.submitTransaction(payment);
  return res.hash;
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
  return sendUsdcPayment(bridge, {
    destination: tx.withdraw_anchor_account,
    amount: tx.amount_in,
    memo: buildMemo(tx),
  });
}
