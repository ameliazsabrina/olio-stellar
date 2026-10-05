import "server-only";
import { requireAccountSubmission } from "../verification/verification.submission";

import { randomBytes } from "node:crypto";
import { Address, Keypair } from "@stellar/stellar-sdk";
import { getServerEnv } from "../../../env.server";
import {
  CCTP_STELLAR_DOMAIN,
  cctpIntakeContract,
  EVM_SOURCES,
  SOLANA_SRC_DOMAIN,
} from "../../../lib/cctp";
import {
  bytesToHex,
  fromBE,
  hexToBytes,
  commitment as noteCommitment,
  R,
  toBE32,
} from "../../../lib/crypto";
import {
  type FeeQuoteEnvelope,
  type SignedFeeQuote,
  serializeFeeQuoteEnvelope,
  signFeeQuote,
  stellarNetworkId,
} from "../../../lib/fee-quote";
import {
  ASYNC_QUOTE_LIFETIME_SECONDS,
  assertCctpQuoteRepresentable,
  DIRECT_QUOTE_LIFETIME_SECONDS,
  type FeeBps,
  isAllowedFeeBps,
  OLIO_DEFAULT_FEE_BPS,
  OLIO_FEE_POLICY_VERSION,
  OLIO_FEE_QUOTE_FORMAT_VERSION,
  quoteOlioFee,
} from "../../../lib/fees";
import {
  networkPassphrase,
  poolId,
  resolveUsernameOnChain,
  simulateRead,
} from "../../../lib/stellar";
import { getAsyncFeeQuoteContexts, getClientFeePolicies } from "../../db/mongo";
import { routeReadiness } from "../cctp/cctp.readiness";
import {
  FeePolicyUnavailableError,
  FeeQuoteBadRequestError,
  FeeQuoteRecipientNotFoundError,
  FeeQuoteRouteUnavailableError,
  FeeQuoteSignerError,
} from "./feeQuotes.errors";
import type {
  IssueInput,
  IssueOutput,
  PreviewInput,
  PreviewOutput,
} from "./feeQuotes.schema";

const ZERO_SOURCE = new Uint8Array(32);
const SUPPORTED_CCTP_DOMAINS = new Set([
  ...Object.keys(EVM_SOURCES).map(Number),
  SOLANA_SRC_DOMAIN,
]);
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

async function resolveRecipient(username: string) {
  let recipient: Awaited<ReturnType<typeof resolveUsernameOnChain>>;
  try {
    recipient = await resolveUsernameOnChain(username);
  } catch {
    throw new FeePolicyUnavailableError(
      "Recipient registry is unavailable. Try again.",
    );
  }
  if (!recipient)
    throw new FeeQuoteRecipientNotFoundError("Recipient was not found.");
  return recipient;
}

async function feeBpsForOwner(
  owner: string,
  now = new Date(),
): Promise<FeeBps> {
  try {
    const policy = await (await getClientFeePolicies()).findOne(
      {
        _id: owner,
        state: "active",
        effectiveAt: { $lte: now },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      { readPreference: "primary" },
    );
    if (policy && !isAllowedFeeBps(policy.feeBps)) {
      throw new Error("stored fee rate is invalid");
    }
    return policy?.feeBps ?? OLIO_DEFAULT_FEE_BPS;
  } catch {
    throw new FeePolicyUnavailableError(
      "Fee policy storage is unavailable. Try again.",
    );
  }
}

function parsePaymentAmount(value: string): bigint {
  const amount = BigInt(value);
  if (amount <= 0n)
    throw new FeeQuoteBadRequestError("Payment amount must be positive.");
  return amount;
}

export async function previewFeeQuote(
  input: PreviewInput,
): Promise<PreviewOutput> {
  const paymentAmount = parsePaymentAmount(input.paymentAmount);
  const recipient = await resolveRecipient(input.username);
  await requireAccountSubmission(recipient.owner);
  const feeBps = await feeBpsForOwner(recipient.owner);
  const breakdown = quoteOlioFee(paymentAmount, feeBps);
  if (input.channel === "cctp") assertCctpQuoteRepresentable(breakdown);
  return {
    paymentAmount: breakdown.paymentAmount.toString(),
    feeBps,
    feeAmount: breakdown.feeAmount.toString(),
    totalAmount: breakdown.totalAmount.toString(),
    policyVersion: OLIO_FEE_POLICY_VERSION,
  };
}

function configuredSigner(): Keypair {
  const secret = getServerEnv().FEE_QUOTE_SIGNING_SECRET;
  if (!secret)
    throw new FeeQuoteSignerError("Fee quote signer is not configured.");
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new FeeQuoteSignerError("Fee quote signer configuration is invalid.");
  }
}

async function assertSignerParity(signer: Keypair): Promise<void> {
  if (!poolId) throw new FeeQuoteSignerError("Pool is not configured.");
  let config: { signer?: unknown };
  try {
    config = (await simulateRead(poolId, "fee_config")) as { signer?: unknown };
  } catch {
    throw new FeeQuoteSignerError(
      "Unable to verify the pool fee quote signer.",
    );
  }
  const onChain =
    config.signer instanceof Uint8Array
      ? config.signer
      : new Uint8Array(config.signer as ArrayBuffer);
  if (!bytesEqual(onChain, new Uint8Array(signer.rawPublicKey()))) {
    throw new FeeQuoteSignerError(
      "Configured fee quote signer does not match the pool.",
    );
  }
}

function validateAddress(value: string, name: string): void {
  try {
    new Address(value);
  } catch {
    throw new FeeQuoteBadRequestError(
      `${name} is not a valid Stellar address.`,
    );
  }
}

export async function issueFeeQuote(
  input: IssueInput,
  _privyUserId: string | null,
): Promise<IssueOutput> {
  if (input.channel === "cctp") {
    // Read the readiness verdict rather than catching a thrown one: a bare
    // catch here would also swallow genuine faults and report them as a
    // closed route. The reason travels with the error for the API boundary.
    const readiness = await routeReadiness(input.sourceDomain);
    if (readiness.state !== "enabled") {
      throw new FeeQuoteRouteUnavailableError(
        readiness.reason,
        readiness.retryAfterMs,
      );
    }
  }
  const paymentAmount = parsePaymentAmount(input.paymentAmount);
  validateAddress(input.depositor, "Depositor");
  const recipient = await resolveRecipient(input.username);
  await requireAccountSubmission(recipient.owner);
  const feeBps = await feeBpsForOwner(recipient.owner);
  const breakdown = quoteOlioFee(paymentAmount, feeBps);
  if (input.channel === "cctp") assertCctpQuoteRepresentable(breakdown);

  const saltBytes = hexToBytes(input.salt);
  const salt = fromBE(saltBytes);
  if (salt >= R)
    throw new FeeQuoteBadRequestError("Salt is outside the note field.");
  const expectedCommitment = toBE32(
    await noteCommitment(paymentAmount, fromBE(recipient.note_pubkey), salt),
  );
  const commitment = hexToBytes(input.commitment);
  if (!bytesEqual(commitment, expectedCommitment)) {
    throw new FeeQuoteBadRequestError(
      "Commitment does not match this recipient and payment.",
    );
  }

  let sourceDomain = 0;
  let sourcePayer = ZERO_SOURCE;
  if (input.channel === "cctp") {
    if (!cctpIntakeContract || input.depositor !== cctpIntakeContract) {
      throw new FeeQuoteBadRequestError(
        "CCTP depositor must be the configured intake contract.",
      );
    }
    if (
      !SUPPORTED_CCTP_DOMAINS.has(input.sourceDomain) ||
      input.sourceDomain === CCTP_STELLAR_DOMAIN
    ) {
      throw new FeeQuoteBadRequestError("Unsupported CCTP source domain.");
    }
    sourceDomain = input.sourceDomain;
    sourcePayer = Uint8Array.from(hexToBytes(input.sourcePayer));
    if (bytesEqual(sourcePayer, ZERO_SOURCE)) {
      throw new FeeQuoteBadRequestError("CCTP source payer cannot be zero.");
    }
  }

  const signer = configuredSigner();
  await assertSignerParity(signer);
  const issuedAt = BigInt(Math.floor(Date.now() / 1000));
  const lifetime =
    input.channel === "direct"
      ? DIRECT_QUOTE_LIFETIME_SECONDS
      : ASYNC_QUOTE_LIFETIME_SECONDS;
  const quote: SignedFeeQuote = {
    formatVersion: OLIO_FEE_QUOTE_FORMAT_VERSION,
    policyVersion: OLIO_FEE_POLICY_VERSION,
    quoteId: new Uint8Array(randomBytes(32)),
    networkId: stellarNetworkId(networkPassphrase),
    pool: poolId,
    depositor: input.depositor,
    commitment,
    paymentAmount,
    feeBps,
    feeAmount: breakdown.feeAmount,
    totalAmount: breakdown.totalAmount,
    channel: input.channel,
    sourceDomain,
    sourcePayer,
    issuedAt,
    expiresAt: issuedAt + BigInt(lifetime),
  };
  const envelope: FeeQuoteEnvelope = {
    quote,
    signature: signFeeQuote(quote, signer),
  };
  if (input.channel === "cctp") {
    try {
      await (await getAsyncFeeQuoteContexts()).insertOne(
        {
          _id: bytesToHex(quote.quoteId),
          channel: "cctp",
          owner: recipient.owner,
          commitment: bytesToHex(commitment),
          notePubkey: bytesToHex(recipient.note_pubkey),
          viewPubkey: bytesToHex(recipient.view_pubkey),
          // Retain public recipient keys long enough to finish delayed burns;
          // the signed quote itself still controls authorization lifetime.
          expiresAt: new Date(Number(quote.expiresAt) * 1000 + 90 * 86_400_000),
          createdAt: new Date(),
        },
        { writeConcern: { w: "majority", j: true } },
      );
    } catch {
      throw new FeePolicyUnavailableError(
        "Unable to persist CCTP recovery context. Try again.",
      );
    }
  }
  return serializeFeeQuoteEnvelope(envelope);
}

// Kept narrow for the operator command and tests; no browser route mutates policy.
export async function setClientFeePolicyForOwner(input: {
  owner: string;
  feeBps: FeeBps;
  state: "active" | "disabled";
  effectiveAt: Date;
  expiresAt: Date | null;
  reason: string;
  updatedBy: string;
}): Promise<void> {
  validateAddress(input.owner, "Owner");
  await (await getClientFeePolicies()).updateOne(
    { _id: input.owner },
    {
      $set: {
        ...input,
        updatedAt: new Date(),
      },
    },
    { upsert: true, writeConcern: { w: "majority", j: true } },
  );
}
