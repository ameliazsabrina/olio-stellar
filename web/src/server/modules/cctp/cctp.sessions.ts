import "server-only";
import { requireAccountSubmission } from "../verification/verification.submission";
import { z } from "zod";
import { Keypair } from "@stellar/stellar-sdk";
import { getServerEnv } from "../../../env.server";
import { cctpIntakeContract } from "../../../lib/cctp";
import {
  bytesToHex,
  commitment,
  fromBE,
  hexToBytes,
  R,
  toBE32,
} from "../../../lib/crypto";
import {
  deserializeFeeQuoteEnvelope,
  stellarNetworkId,
  verifyFeeQuoteSignature,
} from "../../../lib/fee-quote";
import { assertCctpQuoteRepresentable, quoteOlioFee } from "../../../lib/fees";
import {
  networkPassphrase,
  poolId,
  resolveUsernameOnChain,
} from "../../../lib/stellar";
import {
  getAsyncFeeQuoteContexts,
  getCctpSessions,
  type CctpSessionDoc,
} from "../../db/mongo";
import { assertPaymentIngressReady } from "../feeQuotes/feeQuotes.readiness";
import { CctpOperationalError } from "./cctp.errors";
import { assertRouteReady } from "./cctp.readiness";
import { sourceDomainSchema } from "./cctp.config";
import {
  createSessionInput,
  type CreateSessionInput,
  type RecordSubmissionInput,
  type SessionAuth,
  type SessionStatus,
} from "./cctp.schema";
import { normalizeSourceIdentifier } from "./iris.client";
import { digest, seal, sharedBudget, unseal } from "./cctp.storage";
import { sourceRpc } from "./cctp.rpc";

export const recoveryContextSchema = z.object({
  input: createSessionInput.omit({
    capability: true,
    legacySourceTxHash: true,
  }),
  owner: z.string(),
  notePubkey: z.string().regex(/^[a-f0-9]{64}$/),
  viewPubkey: z.string().regex(/^[a-f0-9]{64}$/),
  signerPublic: z.string().regex(/^[a-f0-9]{64}$/),
});
export type RecoveryContext = z.infer<typeof recoveryContextSchema>;
export function sessionContext(session: CctpSessionDoc): RecoveryContext {
  return recoveryContextSchema.parse(
    unseal(session.encryptedContext, session._id),
  );
}
export const sessionIdentity = (
  network: string,
  pool: string,
  quoteId: string,
) => digest(`${network}:${pool}:${quoteId.toLowerCase()}`);
const scope = () => ({
  network: bytesToHex(stellarNetworkId(networkPassphrase)),
  pool: poolId,
});

export function publicSession(session: CctpSessionDoc): SessionStatus {
  return {
    sessionId: session._id,
    sourceDomain: session.sourceDomain,
    stage: session.stage,
    paymentAmount: session.paymentAmount,
    feeAmount: session.feeAmount,
    totalAmount: session.totalAmount,
    sourceTxHash: session.sourceTxHash ?? null,
    destinationTxHash: session.result?.txHash ?? null,
    errorCode: session.errorCode ?? null,
    retryAfterMs: Math.max(5000, session.nextAttemptAt.getTime() - Date.now()),
    updatedAt: session.updatedAt.toISOString(),
    result: session.result ?? null,
  };
}
export async function authorizedSession(auth: SessionAuth) {
  const session = await (await getCctpSessions()).findOne({
    _id: auth.sessionId,
    capabilityHash: digest(auth.capability),
    ...scope(),
  });
  if (!session) throw new CctpOperationalError("unauthorized");
  return session;
}
export async function createSession(
  raw: CreateSessionInput,
): Promise<SessionStatus> {
  const input = createSessionInput.parse(raw);
  const { quote, signature } = deserializeFeeQuoteEnvelope(input.feeQuote);
  const identity = scope();
  const id = sessionIdentity(
    identity.network,
    identity.pool,
    bytesToHex(quote.quoteId),
  );
  const sessions = await getCctpSessions();
  const existing = await sessions.findOne({ _id: id });
  if (existing)
    return publicSession(
      await authorizedSession({ sessionId: id, capability: input.capability }),
    );
  await sharedBudget("sessions:create", 100, 60_000);
  sourceDomainSchema.parse(quote.sourceDomain);
  const signerSecret = getServerEnv().FEE_QUOTE_SIGNING_SECRET;
  if (!signerSecret) throw new CctpOperationalError("configuration");
  const signer = Keypair.fromSecret(signerSecret).rawPublicKey();
  if (
    quote.channel !== "cctp" ||
    quote.pool !== identity.pool ||
    bytesToHex(quote.networkId) !== identity.network ||
    quote.depositor !== cctpIntakeContract ||
    !verifyFeeQuoteSignature(quote, signature, signer)
  )
    throw new CctpOperationalError("binding");
  if (!input.legacySourceTxHash) {
    await assertPaymentIngressReady("cctp");
    await assertRouteReady(quote.sourceDomain);
    if (quote.expiresAt <= BigInt(Math.floor(Date.now() / 1000)))
      throw new CctpOperationalError("binding");
  }
  const expected = quoteOlioFee(quote.paymentAmount, quote.feeBps);
  assertCctpQuoteRepresentable(expected);
  if (
    expected.feeAmount !== quote.feeAmount ||
    expected.totalAmount !== quote.totalAmount
  )
    throw new CctpOperationalError("binding");
  const issuedContext = await (await getAsyncFeeQuoteContexts()).findOne({
    _id: bytesToHex(quote.quoteId),
  });
  // Recovery cannot silently redirect to freshly rotated recipient keys.
  if (!issuedContext) throw new CctpOperationalError("binding");
  const recipient = await resolveUsernameOnChain(input.username);
  if (
    !recipient ||
    recipient.owner !== issuedContext.owner ||
    issuedContext.commitment !== bytesToHex(quote.commitment)
  )
    throw new CctpOperationalError("binding");
  if (!input.legacySourceTxHash)
    await requireAccountSubmission(recipient.owner);
  const salt = fromBE(hexToBytes(input.salt));
  if (
    salt >= R ||
    bytesToHex(
      toBE32(
        await commitment(
          quote.paymentAmount,
          fromBE(hexToBytes(issuedContext.notePubkey)),
          salt,
        ),
      ),
    ) !== bytesToHex(quote.commitment)
  )
    throw new CctpOperationalError("binding");
  const context: RecoveryContext = {
    input: {
      username: input.username,
      salt: input.salt,
      feeQuote: input.feeQuote,
    },
    owner: issuedContext.owner,
    notePubkey: issuedContext.notePubkey,
    viewPubkey: issuedContext.viewPubkey,
    signerPublic: signer.toString("hex"),
  };
  const now = new Date();
  const session: CctpSessionDoc = {
    _id: id,
    ...identity,
    quoteId: bytesToHex(quote.quoteId),
    capabilityHash: digest(input.capability),
    encryptedContext: seal(context, id),
    sourceDomain: quote.sourceDomain,
    stage: input.legacySourceTxHash ? "source_submitted" : "awaiting_signature",
    ...(input.legacySourceTxHash
      ? {
          sourceTxHash: normalizeSourceIdentifier(
            quote.sourceDomain,
            input.legacySourceTxHash,
          ),
        }
      : {}),
    ...(quote.sourceDomain !== 5 && !input.legacySourceTxHash
      ? {
          sourceScanBlock: z
            .string()
            .regex(/^0x[0-9a-fA-F]+$/)
            .parse(await sourceRpc(quote.sourceDomain, "eth_blockNumber")),
        }
      : {}),
    paymentAmount: quote.paymentAmount.toString(),
    feeAmount: quote.feeAmount.toString(),
    totalAmount: quote.totalAmount.toString(),
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await sessions.insertOne(session, {
      writeConcern: { w: "majority", j: true },
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  return publicSession(
    await authorizedSession({ sessionId: id, capability: input.capability }),
  );
}
export async function recordSubmission(
  input: RecordSubmissionInput,
): Promise<SessionStatus> {
  const session = await authorizedSession(input);
  if (session.stage === "completed") return publicSession(session);
  const hash = input.sourceTxHash
    ? normalizeSourceIdentifier(session.sourceDomain, input.sourceTxHash)
    : undefined;
  if (session.sourceTxHash && hash && session.sourceTxHash !== hash)
    throw new CctpOperationalError("binding");
  const sessions = await getCctpSessions();
  if (hash) {
    const updated = await sessions.updateOne(
      {
        _id: session._id,
        $or: [{ sourceTxHash: hash }, { sourceTxHash: { $exists: false } }],
      },
      {
        $set: {
          sourceTxHash: hash,
          ...(input.solanaBlockhash
            ? { solanaBlockhash: input.solanaBlockhash }
            : {}),
          ...(input.solanaLastValidBlockHeight !== undefined
            ? { solanaLastValidBlockHeight: input.solanaLastValidBlockHeight }
            : {}),
          updatedAt: new Date(),
        },
      },
      { writeConcern: { w: "majority", j: true } },
    );
    if (updated.matchedCount !== 1) throw new CctpOperationalError("binding");
  }
  await sessions.updateOne(
    {
      _id: session._id,
      stage: { $in: ["awaiting_signature", "submission_unknown"] },
    },
    {
      $set: {
        stage: hash ? "source_submitted" : "submission_unknown",
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
  return publicSession(await authorizedSession(input));
}
export async function resumeSession(auth: SessionAuth): Promise<SessionStatus> {
  const session = await authorizedSession(auth);
  if (session.stage !== "completed") {
    // Keep provider Retry-After and worker leases intact. Resume never re-burns.
    await (await getCctpSessions()).updateOne(
      { _id: session._id },
      { $set: { updatedAt: new Date() } },
    );
  }
  return publicSession(session);
}
