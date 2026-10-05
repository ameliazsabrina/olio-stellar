import "server-only";
import { randomUUID } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  Horizon,
  Keypair,
  rpc,
  StrKey,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";

import { env } from "../../../env";
import { getServerEnv } from "../../../env.server";
import {
  cctpBinding,
  cctpIntakeContract,
  cctpStellar,
  SOLANA_SRC_DOMAIN,
} from "../../../lib/cctp";
import { parseCctpMessage } from "../../../lib/cctpMessage";
import {
  bytesToHex,
  commitment,
  fromBaseUnits,
  fromBE,
  hexToBytes,
  toBE32,
} from "../../../lib/crypto";
import {
  deserializeFeeQuoteEnvelope,
  feeQuoteScVal,
  signFeeQuote,
  stellarNetworkId,
  verifyFeeQuoteSignature,
} from "../../../lib/fee-quote";
import { isAllowedFeeBps, quoteOlioFee } from "../../../lib/fees";
import {
  networkPassphrase,
  poolId,
  resolveUsernameOnChain,
  server,
  simulateRead,
} from "../../../lib/stellar";
import { getAsyncFeeQuoteContexts, getCctpRelays } from "../../db/mongo";
import {
  depositArgs,
  invokeAsSource as invokeWithSequenceLock,
  leafIndexFrom,
  type PreparedCallback,
  proveNote,
  scAddr,
  scBytesHex,
  type SettlementDeps,
  settlementKeypair,
} from "../../lib/poolSettlement";
import {
  CctpAttestationError,
  CctpConfigError,
  CctpPayeeError,
  CctpRelayError,
} from "./cctp.errors";
import type { AttestationOutput, RelayInput, RelayOutput } from "./cctp.schema";
import {
  missingTransactionProvenExpired,
  burnWasAuthorized,
  preparedTransactionResolution,
} from "./cctpRecovery";

import { fetchIrisMessages, selectIrisMessage } from "./iris.client";
import { assertMessageBinding } from "./cctp.binding";
import { claimLock, digest } from "./cctp.storage";
import { CctpOperationalError } from "./cctp.errors";
import { sourceRpc } from "./cctp.rpc";
import type { RecoveryContext } from "./cctp.sessions";

const horizonUrl = env.NEXT_PUBLIC_STELLAR_HORIZON_URL;
const horizon = new Horizon.Server(horizonUrl, {
  allowHttp: horizonUrl.startsWith("http://"),
});
const RELAY_LEASE_MS = 10 * 60_000;

const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const EVM_TO_STELLAR_SCALE = 10n;
const settlement: SettlementDeps = {
  claimLock,
  lockKey: (publicKey) => `operator:${digest(networkPassphrase)}:${publicKey}`,
  relayError: (message) => new CctpRelayError(message),
  busyError: () => new CctpOperationalError("pending"),
};
const invokeAsSource = (
  kp: Keypair,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  onPrepared?: PreparedCallback,
) =>
  invokeWithSequenceLock(settlement, kp, contractId, method, args, onPrepared);

export async function fetchAttestation(
  sourceDomain: number,
  txHash: string,
): Promise<AttestationOutput> {
  const messages = await fetchIrisMessages(sourceDomain, txHash);
  // Legacy API lacks a quote selector. Never guess when a transaction emitted multiple messages.
  if (messages.length > 1) throw new CctpOperationalError("binding");
  const selected = selectIrisMessage(messages, () => true);
  return selected
    ? {
        status: "complete",
        message: selected.message!,
        attestation: selected.attestation!,
      }
    : { status: "pending", message: null, attestation: null };
}

function operatorKeypair(): Keypair {
  const kp = settlementKeypair(
    getServerEnv().CCTP_OPERATOR_SECRET,
    () => new CctpConfigError("CCTP_OPERATOR_SECRET is not configured."),
  );
  if (!cctpIntakeContract) {
    throw new CctpConfigError(
      "NEXT_PUBLIC_CCTP_INTAKE_CONTRACT is not configured.",
    );
  }
  return kp;
}

export async function sourceBurnTimestamp(
  sourceDomain: number,
  sourceTxHash: string,
  message: string,
): Promise<number> {
  const selected = selectIrisMessage(
    await fetchIrisMessages(sourceDomain, sourceTxHash),
    (candidate) => bytesEqual(hexToBytes(candidate), hexToBytes(message)),
  );
  if (!selected)
    throw new CctpRelayError(
      "The source transaction does not match the attested CCTP message.",
    );
  if (sourceDomain === SOLANA_SRC_DOMAIN) {
    const transaction = (await sourceRpc(sourceDomain, "getTransaction", [
      sourceTxHash,
      { maxSupportedTransactionVersion: 0, commitment: "finalized" },
    ])) as { blockTime?: number; meta?: { err: unknown } } | null;
    if (!transaction?.blockTime || !transaction.meta || transaction.meta.err)
      throw new CctpRelayError("Unable to verify the finalized Solana burn.");
    return transaction.blockTime;
  }
  const receipt = (await sourceRpc(sourceDomain, "eth_getTransactionReceipt", [
    sourceTxHash,
  ])) as { status?: string; blockNumber?: string; blockHash?: string } | null;
  if (receipt?.status !== "0x1" || !receipt.blockNumber)
    throw new CctpRelayError("Unable to verify the source burn.");
  const block = (await sourceRpc(sourceDomain, "eth_getBlockByNumber", [
    receipt.blockNumber,
    false,
  ])) as { timestamp?: string; hash?: string } | null;
  if (!block?.timestamp || block.hash !== receipt.blockHash)
    throw new CctpRelayError("Unable to verify the source burn block.");
  return Number(BigInt(block.timestamp));
}

export async function relayDeposit(
  input: RelayInput,
  recovery?: RecoveryContext,
): Promise<RelayOutput> {
  return doRelayDeposit(input, recovery);
}

async function doRelayDeposit(
  input: RelayInput,
  recovery?: RecoveryContext,
): Promise<RelayOutput> {
  const envelope = deserializeFeeQuoteEnvelope(input.feeQuote);
  let quote = envelope.quote;
  assertMessageBinding(input.message, quote);
  const msg = parseCctpMessage(input.message);
  const messageHash = bytesToHex(sha256(hexToBytes(input.message)));
  const relays = await getCctpRelays();
  const existing = await relays.findOne({ _id: messageHash });
  if (
    existing?.state === "deposited" &&
    existing.depositTxHash &&
    existing.leafIndex !== undefined
  ) {
    return {
      leafIndex: existing.leafIndex,
      paymentAmount: fromBaseUnits(BigInt(existing.paymentAmount)),
      feeAmount: fromBaseUnits(BigInt(existing.feeAmount)),
      totalAmount: fromBaseUnits(BigInt(existing.totalAmount)),
      feePolicyVersion: existing.policyVersion ?? quote.policyVersion,
      txHash: existing.depositTxHash,
    };
  }

  const payee = recovery
    ? {
        owner: recovery.owner,
        note_pubkey: hexToBytes(recovery.notePubkey),
        view_pubkey: hexToBytes(recovery.viewPubkey),
      }
    : await resolveUsernameOnChain(input.username);
  if (!payee) throw new CctpPayeeError(input.username);
  const operator = operatorKeypair();
  const intakeRaw = StrKey.decodeContract(cctpIntakeContract);
  if (!bytesEqual(msg.mintRecipient, intakeRaw)) {
    throw new CctpRelayError("Burn does not target the intake contract.");
  }
  if (
    quote.channel !== "cctp" ||
    quote.pool !== poolId ||
    quote.depositor !== cctpIntakeContract ||
    !bytesEqual(quote.networkId, stellarNetworkId(networkPassphrase)) ||
    quote.sourceDomain !== msg.sourceDomain ||
    !bytesEqual(quote.sourcePayer, msg.messageSender)
  ) {
    throw new CctpRelayError(
      "Burn source does not match the signed fee quote.",
    );
  }
  if (!isAllowedFeeBps(quote.feeBps)) {
    throw new CctpRelayError("Unsupported signed fee rate.");
  }
  const expected = quoteOlioFee(quote.paymentAmount, quote.feeBps);
  if (
    expected.feeAmount !== quote.feeAmount ||
    expected.totalAmount !== quote.totalAmount
  ) {
    throw new CctpRelayError("Signed fee arithmetic is invalid.");
  }
  const quoteContext = recovery
    ? { ...recovery, commitment: bytesToHex(quote.commitment) }
    : await (await getAsyncFeeQuoteContexts()).findOne({
        _id: bytesToHex(quote.quoteId),
      });
  if (
    quoteContext &&
    (quoteContext.owner !== payee.owner ||
      quoteContext.commitment !== bytesToHex(quote.commitment))
  ) {
    throw new CctpRelayError("Fee quote recovery context is inconsistent.");
  }
  const notePubkey = quoteContext
    ? hexToBytes(quoteContext.notePubkey)
    : payee.note_pubkey;
  const viewPubkey = quoteContext
    ? hexToBytes(quoteContext.viewPubkey)
    : payee.view_pubkey;
  const salt = fromBE(hexToBytes(input.salt));
  const commitmentBytes = toBE32(
    await commitment(quote.paymentAmount, fromBE(notePubkey), salt),
  );
  if (!bytesEqual(commitmentBytes, quote.commitment)) {
    throw new CctpRelayError("Signed commitment does not match this payee.");
  }
  if (!bytesEqual(msg.hookData, cctpBinding(quote))) {
    throw new CctpRelayError(
      "Burn hook does not match the signed payment binding.",
    );
  }
  const grossAmount = msg.amount * EVM_TO_STELLAR_SCALE;
  if (grossAmount <= 0n) {
    throw new CctpRelayError("Burn amount is zero.");
  }
  if (grossAmount !== quote.totalAmount) {
    throw new CctpRelayError(
      `Burn total ${grossAmount} != quoted total ${quote.totalAmount}.`,
    );
  }

  const feeConfig = (await simulateRead(poolId, "fee_config")) as {
    signer: unknown;
  };
  const signerPublic =
    feeConfig.signer instanceof Uint8Array
      ? feeConfig.signer
      : new Uint8Array(feeConfig.signer as ArrayBuffer);
  if (
    !verifyFeeQuoteSignature(
      quote,
      envelope.signature,
      recovery ? hexToBytes(recovery.signerPublic) : signerPublic,
    )
  ) {
    throw new CctpRelayError("Fee quote signature is invalid.");
  }
  // Verify the source association even while the quote is unexpired.
  const burnedAt = await sourceBurnTimestamp(
    msg.sourceDomain,
    input.sourceTxHash,
    input.message,
  );
  if (
    BigInt(burnedAt) + 60n < quote.issuedAt ||
    !burnWasAuthorized(burnedAt, quote.expiresAt)
  )
    throw new CctpOperationalError("binding");
  if (quote.expiresAt < BigInt(Math.floor(Date.now() / 1000))) {
    if (!burnWasAuthorized(burnedAt, quote.expiresAt)) {
      throw new CctpRelayError(
        "The CCTP burn occurred after the signed fee quote expired.",
      );
    }
    const signer = configuredFeeSigner(signerPublic);
    const issuedAt = BigInt(Math.floor(Date.now() / 1000));
    quote = { ...quote, issuedAt, expiresAt: issuedAt + 86_400n };
    envelope.quote = quote;
    envelope.signature = signFeeQuote(quote, signer);
  }

  const leaseOwner = randomUUID();
  const now = new Date();
  await relays.updateOne(
    { _id: messageHash },
    {
      $setOnInsert: {
        quoteId: bytesToHex(quote.quoteId),
        commitment: bytesToHex(quote.commitment),
        paymentAmount: quote.paymentAmount.toString(),
        feeAmount: quote.feeAmount.toString(),
        totalAmount: quote.totalAmount.toString(),
        policyVersion: quote.policyVersion,
        state: "validated",
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true },
  );
  const leased = await relays.findOneAndUpdate(
    {
      _id: messageHash,
      state: { $ne: "deposited" },
      $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }],
    },
    {
      $set: {
        leaseOwner,
        leaseUntil: new Date(now.getTime() + RELAY_LEASE_MS),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!leased || leased.leaseOwner !== leaseOwner) {
    throw new CctpRelayError(
      "This burn is already being relayed. Retry shortly.",
    );
  }

  // Funding is a deployment prerequisite; never fall back to a faucet in a settlement job.
  await horizon.loadAccount(operator.publicKey());
  let relayState = leased.state;
  if (relayState === "validated") {
    const mint = await invokeAsSource(
      operator,
      cctpStellar.messageTransmitter,
      "receive_message",
      [
        scAddr(operator.publicKey()),
        scBytesHex(input.message),
        scBytesHex(input.attestation),
      ],
      async (mintTxHash, mintTimeBounds) => {
        const checkpoint = await relays.updateOne(
          {
            _id: messageHash,
            leaseOwner,
            leaseUntil: { $gt: new Date() },
            state: "validated",
          },
          {
            $set: {
              state: "minting",
              mintTxHash,
              mintPreparedAt: new Date(),
              mintTimeBounds,
              updatedAt: new Date(),
            },
          },
        );
        if (checkpoint.matchedCount !== 1) {
          throw new CctpRelayError(
            "Lost the relay lease before mint submission.",
          );
        }
      },
    );
    const checkpoint = await relays.updateOne(
      { _id: messageHash, leaseOwner },
      {
        $set: {
          state: "minted",
          mintTxHash: mint.txHash,
          leaseUntil: new Date(Date.now() + RELAY_LEASE_MS),
          updatedAt: new Date(),
        },
      },
    );
    if (checkpoint.matchedCount !== 1) {
      throw new CctpRelayError("Lost the relay lease after mint confirmation.");
    }
    relayState = "minted";
  }

  if (relayState === "minting") {
    if (!leased.mintTxHash) {
      throw new CctpRelayError(
        "Mint checkpoint is missing its transaction hash.",
      );
    }
    const mint = await server.getTransaction(leased.mintTxHash);
    const resolution = preparedTransactionResolution(
      mint.status,
      leased.mintPreparedAt,
    );
    if (resolution === "success") {
      const checkpoint = await relays.updateOne(
        { _id: messageHash, leaseOwner, state: "minting" },
        {
          $set: {
            state: "minted",
            leaseUntil: new Date(Date.now() + RELAY_LEASE_MS),
            updatedAt: new Date(),
          },
        },
      );
      if (checkpoint.matchedCount !== 1) {
        throw new CctpRelayError("Lost the relay lease during mint recovery.");
      }
      relayState = "minted";
    } else if (
      resolution === "failed" ||
      missingTransactionProvenExpired(mint, leased.mintTimeBounds)
    ) {
      const released = await relays.updateOne(
        { _id: messageHash, leaseOwner, state: "minting" },
        {
          $set: { state: "validated", updatedAt: new Date() },
          $unset: {
            leaseOwner: "",
            leaseUntil: "",
            mintTxHash: "",
            mintPreparedAt: "",
          },
        },
      );
      if (released.matchedCount !== 1) {
        throw new CctpRelayError(
          "The recorded CCTP mint failed and the relay lease was lost.",
        );
      }
      throw new CctpRelayError(
        "The recorded CCTP mint failed safely. Retry the relay.",
      );
    } else {
      throw new CctpRelayError(
        "The CCTP mint is still pending or temporarily unavailable. Retry shortly.",
      );
    }
  }

  if (relayState === "depositing") {
    if (!leased.depositTxHash) {
      throw new CctpRelayError(
        "Deposit checkpoint is missing its transaction hash.",
      );
    }
    const deposit = await server.getTransaction(leased.depositTxHash);
    const resolution = preparedTransactionResolution(
      deposit.status,
      leased.depositPreparedAt,
    );
    if (resolution === "success") {
      if (deposit.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new CctpRelayError("Recovered deposit status was inconsistent.");
      }
      const leafIndex = Number(
        deposit.returnValue ? scValToNative(deposit.returnValue) : NaN,
      );
      if (!Number.isSafeInteger(leafIndex) || leafIndex < 0) {
        throw new CctpRelayError(
          "Recovered deposit did not contain a valid leaf index.",
        );
      }
      const completed = await relays.updateOne(
        { _id: messageHash, leaseOwner, state: "depositing" },
        {
          $set: { state: "deposited", leafIndex, updatedAt: new Date() },
          $unset: { leaseOwner: "", leaseUntil: "" },
        },
      );
      if (completed.matchedCount !== 1) {
        throw new CctpRelayError(
          "Lost the relay lease while recovering the deposit.",
        );
      }
      return {
        leafIndex,
        paymentAmount: fromBaseUnits(quote.paymentAmount),
        feeAmount: fromBaseUnits(quote.feeAmount),
        totalAmount: fromBaseUnits(quote.totalAmount),
        feePolicyVersion: quote.policyVersion,
        txHash: leased.depositTxHash,
      };
    }
    if (
      resolution === "failed" ||
      missingTransactionProvenExpired(deposit, leased.depositTimeBounds)
    ) {
      await relays.updateOne(
        { _id: messageHash, leaseOwner, state: "depositing" },
        {
          $set: { state: "minted", updatedAt: new Date() },
          $unset: {
            leaseOwner: "",
            leaseUntil: "",
            depositTxHash: "",
            depositPreparedAt: "",
          },
        },
      );
      throw new CctpRelayError(
        "The prepared pool deposit did not complete. Retry the relay.",
      );
    }
    throw new CctpRelayError(
      "The pool deposit is still pending. Retry shortly.",
    );
  }

  const proven = await proveNote({
    commitment: commitmentBytes,
    amount: quote.paymentAmount,
    ownerPk: fromBE(notePubkey),
    viewPubkey,
    salt,
  });

  const { value, txHash } = await invokeAsSource(
    operator,
    cctpIntakeContract,
    "deposit_to_pool",
    depositArgs(
      { commitment: commitmentBytes, amount: quote.paymentAmount },
      quote,
      envelope.signature,
      proven,
    ),
    async (depositTxHash, depositTimeBounds) => {
      const checkpoint = await relays.updateOne(
        {
          _id: messageHash,
          leaseOwner,
          leaseUntil: { $gt: new Date() },
          state: "minted",
        },
        {
          $set: {
            state: "depositing",
            depositTxHash,
            depositPreparedAt: new Date(),
            depositTimeBounds,
            updatedAt: new Date(),
          },
        },
      );
      if (checkpoint.matchedCount !== 1) {
        throw new CctpRelayError(
          "Lost the relay lease before deposit submission.",
        );
      }
    },
  );

  const leafIndex = leafIndexFrom(settlement, value);
  const completed = await relays.updateOne(
    { _id: messageHash, leaseOwner, state: "depositing" },
    {
      $set: {
        state: "deposited",
        depositTxHash: txHash,
        leafIndex,
        updatedAt: new Date(),
      },
      $unset: { leaseOwner: "", leaseUntil: "" },
    },
  );
  if (completed.matchedCount !== 1) {
    throw new CctpRelayError(
      "Lost the relay lease before recording completion.",
    );
  }

  return {
    leafIndex,
    paymentAmount: fromBaseUnits(quote.paymentAmount),
    feeAmount: fromBaseUnits(quote.feeAmount),
    totalAmount: fromBaseUnits(quote.totalAmount),
    feePolicyVersion: quote.policyVersion,
    txHash,
  };
}

function configuredFeeSigner(expectedPublic: Uint8Array): Keypair {
  const secret = getServerEnv().FEE_QUOTE_SIGNING_SECRET;
  if (!secret) {
    throw new CctpConfigError("FEE_QUOTE_SIGNING_SECRET is not configured.");
  }
  let signer: Keypair;
  try {
    signer = Keypair.fromSecret(secret);
  } catch {
    throw new CctpConfigError("Fee quote signer is invalid.");
  }
  if (!bytesEqual(new Uint8Array(signer.rawPublicKey()), expectedPublic)) {
    throw new CctpConfigError("Fee quote signer does not match the pool.");
  }
  return signer;
}
