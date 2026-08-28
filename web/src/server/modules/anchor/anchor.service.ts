import "server-only";

import {
  Horizon,
  Keypair,
  Networks,
  StellarToml,
  WebAuth,
} from "@stellar/stellar-sdk";
import { getPublicEnv } from "../../../env";
import { getServerEnv } from "../../../env.server";
import { currentWallet } from "../wallets/wallets.service";
import {
  AnchorBridgeError,
  AnchorChallengeError,
  AnchorConfigError,
} from "./anchor.errors";
import type {
  SignClientChallengeInput,
  SignClientChallengeOutput,
} from "./anchor.schema";

const horizonUrl = getPublicEnv().NEXT_PUBLIC_STELLAR_HORIZON_URL;
const horizon = new Horizon.Server(horizonUrl, {
  allowHttp: horizonUrl.startsWith("http://"),
});

function configuredDomain(name: string, value: string | undefined): string {
  const normalized = value
    ?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!normalized) throw new AnchorConfigError(`${name} is not configured.`);
  return normalized;
}

function signingKeypair(): Keypair {
  const secret = getServerEnv().SEP10_CLIENT_SIGNING_SECRET;
  if (!secret) {
    throw new AnchorConfigError(
      "SEP10_CLIENT_SIGNING_SECRET is not configured.",
    );
  }
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new AnchorConfigError("SEP10_CLIENT_SIGNING_SECRET is malformed.");
  }
}

function sponsorPublicKey(): string {
  const secret = getServerEnv().BRIDGE_SPONSOR_SECRET;
  if (!secret) {
    throw new AnchorConfigError("BRIDGE_SPONSOR_SECRET is not configured.");
  }
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    throw new AnchorConfigError("BRIDGE_SPONSOR_SECRET is malformed.");
  }
}

export function sep10ClientSigningPublicKey(): string {
  return signingKeypair().publicKey();
}

export function sep10NetworkPassphrase(): string {
  const networkPassphrase =
    getPublicEnv().NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  if (
    networkPassphrase !== Networks.TESTNET &&
    networkPassphrase !== Networks.PUBLIC
  ) {
    throw new AnchorConfigError(
      "SEP-10 client signing requires a supported Stellar network.",
    );
  }
  return networkPassphrase;
}

async function assertSponsorCreatedBridge(
  bridgePublicKey: string,
): Promise<void> {
  const sponsor = sponsorPublicKey();
  let records: Array<Record<string, unknown>> = [];
  try {
    const page = await horizon
      .operations()
      .forAccount(bridgePublicKey)
      .order("asc")
      .limit(5)
      .call();
    records = page.records as unknown as Array<Record<string, unknown>>;
  } catch {
    throw new AnchorBridgeError(
      "Could not verify the payout account on Stellar.",
    );
  }

  const createdBySponsor = records.some(
    (record) =>
      record.type === "create_account" &&
      record.account === bridgePublicKey &&
      record.source_account === sponsor,
  );
  if (!createdBySponsor) {
    throw new AnchorBridgeError(
      "The payout account was not created by Olio's sponsor.",
    );
  }
}

function assertClientDomainOperation(
  tx: ReturnType<typeof WebAuth.readChallengeTx>["tx"],
  clientDomain: string,
  clientSigningKey: string,
): void {
  const operations = tx.operations.filter(
    (operation) =>
      operation.type === "manageData" && operation.name === "client_domain",
  );
  if (operations.length !== 1) {
    throw new AnchorChallengeError(
      "SEP-10 challenge must contain one client_domain operation.",
    );
  }
  const operation = operations[0];
  if (
    operation.type !== "manageData" ||
    operation.source !== clientSigningKey ||
    !operation.value ||
    operation.value.toString() !== clientDomain
  ) {
    throw new AnchorChallengeError(
      "SEP-10 challenge has invalid client-domain attribution.",
    );
  }
}

export async function signClientChallenge(
  input: SignClientChallengeInput,
  privyUserId?: string,
): Promise<SignClientChallengeOutput> {
  const networkPassphrase = sep10NetworkPassphrase();
  const isMainnet = networkPassphrase === Networks.PUBLIC;

  const anchorDomain = configuredDomain(
    "NEXT_PUBLIC_SEP24_ANCHOR_URL",
    getPublicEnv().NEXT_PUBLIC_SEP24_ANCHOR_URL,
  );
  const clientDomain = configuredDomain(
    "NEXT_PUBLIC_SEP10_CLIENT_DOMAIN",
    getPublicEnv().NEXT_PUBLIC_SEP10_CLIENT_DOMAIN,
  );
  const clientKeypair = signingKeypair();

  let toml: Awaited<ReturnType<typeof StellarToml.Resolver.resolve>>;
  try {
    toml = await StellarToml.Resolver.resolve(anchorDomain);
  } catch {
    throw new AnchorChallengeError(
      "Could not verify the configured anchor metadata.",
    );
  }
  if (
    toml.NETWORK_PASSPHRASE !== networkPassphrase ||
    !toml.SIGNING_KEY ||
    !toml.WEB_AUTH_ENDPOINT
  ) {
    throw new AnchorChallengeError(
      "The configured anchor does not advertise valid SEP-10 metadata for this network.",
    );
  }
  const webAuthUrl = new URL(toml.WEB_AUTH_ENDPOINT);
  if (webAuthUrl.protocol !== "https:") {
    throw new AnchorChallengeError(
      "The mainnet anchor authentication endpoint must use HTTPS.",
    );
  }

  let parsed: ReturnType<typeof WebAuth.readChallengeTx>;
  try {
    parsed = WebAuth.readChallengeTx(
      input.transactionXdr,
      toml.SIGNING_KEY,
      networkPassphrase,
      [anchorDomain],
      webAuthUrl.host,
    );
  } catch {
    throw new AnchorChallengeError("The SEP-10 challenge is invalid.");
  }
  if (parsed.clientAccountID !== input.accountPublicKey) {
    throw new AnchorChallengeError(
      "SEP-10 challenge is for a different payout account.",
    );
  }

  assertClientDomainOperation(
    parsed.tx,
    clientDomain,
    clientKeypair.publicKey(),
  );

  const recognized = WebAuth.gatherTxSigners(parsed.tx, [
    toml.SIGNING_KEY,
    input.accountPublicKey,
    clientKeypair.publicKey(),
  ]);
  if (
    !recognized.includes(toml.SIGNING_KEY) ||
    !recognized.includes(input.accountPublicKey) ||
    recognized.length !== parsed.tx.signatures.length
  ) {
    throw new AnchorChallengeError(
      "SEP-10 challenge does not have the expected payout-account signature.",
    );
  }

  // Mainnet bridge funding is a public, rate-limited endpoint, so require proof
  // that Olio's sponsor created the account before applying the client-domain
  // signature. Testnet accounts are created by Friendbot; possession of the
  // bridge key is proven by its validated challenge signature instead.
  if (input.accountKind === "cash-in") {
    if (!privyUserId) {
      throw new AnchorBridgeError(
        "Sign in before starting a MoneyGram cash-in.",
      );
    }
    const wallet = await currentWallet(privyUserId);
    if (!wallet || wallet.privyWalletAddress !== input.accountPublicKey) {
      throw new AnchorBridgeError(
        "The cash-in account is not the authenticated user's Privy wallet.",
      );
    }
  } else if (isMainnet) {
    await assertSponsorCreatedBridge(input.accountPublicKey);
  }

  if (!recognized.includes(clientKeypair.publicKey())) {
    parsed.tx.sign(clientKeypair);
  }
  return { signedTransactionXdr: parsed.tx.toXDR() };
}
