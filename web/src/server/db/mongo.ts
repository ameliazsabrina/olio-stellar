import { type Binary, type Collection, type Db, MongoClient } from "mongodb";
import { getServerEnv } from "../../env.server-schema";

export type DepositDoc = {
  _id: number;
  commitment: Binary;
  ephemeralPk: Binary;
  ciphertext: Binary;
  ledger: number;
  txHash: string;
  eventId?: string | null;
  ts: Date;
};

export type WithdrawalDoc = {
  _id: string;
  dest: string;
  amount: bigint;
  txHash: string;
  eventId: string;
  ledger: number;
  ts: Date;
};

export type PoolRootDoc = {
  _id: number;
  root: string;
  ledger: number;
  ts: Date;
};

export type UsernameDoc = {
  _id: string; // lowercased username
  owner: string;
  notePubkey: Binary;
  viewPubkey: Binary;
  createdLedger: number; // ledger this cache entry was (re)written at, not registration ledger
  createdAt: Date;
  updatedAt?: Date;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
};

export type IndexerStateDoc = {
  _id: "pool" | "registry" | "settlements" | "evidence";
  lastLedger: number;
  lastLeafIndex?: number;
  updatedAt: Date;
  poolId?: string;
  publishedLedger?: number;
  publishedLeafIndex?: number;
  indexedAt?: Date;
  health?: "healthy" | "degraded";
  lastError?: string;
  leaseOwner?: string;
  leaseUntil?: Date;
  nullifiersComplete?: boolean;
  rootLeafCount?: number;
  rootFrontier?: string[];
  rootsVerifiedAt?: Date;
  rootsMismatch?: boolean;
  lastRunAt?: Date;
  degradedReasons?: string[];
};

export type SpentNullifierDoc = {
  _id: string;
  ledger: number;
  eventId: string;
  txHash: string;
  ts: Date;
};

export type FeeDoc = {
  _id: string;
  txHash: string;
  ledger: number;
  payer: string;
  feeRecipient: string;
  paymentAmount: string;
  feeAmount: string;
  totalAmount: string;
  policyVersion: number;
  feeBps: number;
  quoteId: string;
  ts: Date;
};

export type CctpRelayDoc = {
  _id: string;
  quoteId: string;
  commitment: string;
  paymentAmount: string;
  feeAmount: string;
  totalAmount: string;
  policyVersion: number;
  state: "validated" | "minting" | "minted" | "depositing" | "deposited";
  leaseOwner?: string;
  leaseUntil?: Date;
  mintTxHash?: string;
  mintPreparedAt?: Date;
  mintTimeBounds?: { minTime: number; maxTime: number };
  depositTxHash?: string;
  depositPreparedAt?: Date;
  depositTimeBounds?: { minTime: number; maxTime: number };
  leafIndex?: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AsyncFeeQuoteContextDoc = {
  _id: string;
  channel: "cctp";
  owner: string;
  commitment: string;
  notePubkey: string;
  viewPubkey: string;
  expiresAt: Date;
  createdAt: Date;
};

export type PaymentLinkDoc = {
  _id: string;
  owner: string;
  slug?: string;
  amount: string | null;
  description?: string | null;
  label: string | null;
  state?: "active" | "archived";
  status: "pending" | "paid";
  manageTokenHash?: string; // sha-256 of the per-link manage capability token
  businessId?: string;
  businessClaimedAt?: Date;
  invoiceId?: string | null;
  createdAt: Date;
  updatedAt?: Date;
  archivedAt?: Date | null;
};

export type StellarNetworkName = "testnet" | "mainnet";

export type InvoiceState =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "void";

export type InvoiceDoc = {
  _id: string;
  businessId: string;
  number: number;
  currentVersion: number;
  state: InvoiceState;
  amountDue: bigint;
  allocatedAmount: bigint;
  refundedAmount: bigint;
  appliedAllocationIds: string[];
  projectionRevision: number;
  issuedAt: Date | null;
  cancelledAt: Date | null;
  voidedAt: Date | null;
  erasedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceVersionDoc = {
  _id: string;
  invoiceId: string;
  version: number;
  businessId: string;
  network: StellarNetworkName;
  poolId: string;
  asset: string;
  amountDue: bigint;
  issuedAt: Date;
  dueAt: Date | null;
  encryptedContent: string | null;
  wrappedKey: string | null;
  contentCommitment: string;
  invoiceCommitment: string;
  createdBy: string;
  createdAt: Date;
};

export type InvoiceEventKind =
  | "created"
  | "issued"
  | "revised"
  | "cancelled"
  | "allocation"
  | "refund"
  | "erased";

export type InvoiceEventDoc = {
  _id: string;
  invoiceId: string;
  businessId: string;
  kind: InvoiceEventKind;
  version: number | null;
  amount: bigint | null;
  settlementId: string | null;
  actor: string;
  at: Date;
};

export type InvoiceCounterDoc = {
  _id: string;
  seq: number;
};

export type PaymentChannel = "direct" | "cctp";

export type PaymentIntentDoc = {
  _id: string;
  invoiceId: string;
  invoiceVersion: number;
  invoiceCommitment: string;
  intentNonce: string;
  quoteId: string;
  businessId: string;
  noteCommitment: string;
  amount: bigint;
  channel: PaymentChannel;
  state: "open" | "settled" | "expired";
  expiresAt: Date;
  railRefs: { sourceDomain?: number; payerSentAt?: Date };
  settlementId: string | null;
  settledAt: Date | null;
  createdAt: Date;
};

export type QuoteContextDoc = {
  _id: string;
  channel: PaymentChannel;
  network: StellarNetworkName;
  poolId: string;
  recipientOwner: string;
  businessId: string | null;
  notePubkey: string;
  viewPubkey?: string;
  commitment: string;
  paymentAmount: bigint | null;
  intentId: string | null;
  settlementId: string | null;
  source: "issue" | "async_copy" | "cctp_session";
  createdAt: Date;
};

export type SettlementRail = "direct" | "cctp" | "fiat";

export type EvidenceLevel =
  | "intent_bound"
  | "attributed"
  | "historical_claim"
  | "unattributed";

export type SettlementQualification = {
  counted: boolean;
  selfFunded: boolean;
  policyVersion: number;
};

export type SettlementDoc = {
  _id: string;
  network: StellarNetworkName;
  poolId: string;
  asset: string;
  txHash: string;
  eventId: string | null;
  leafIndex: number;
  noteCommitment: string;
  quoteId: string | null;
  intentId: string | null;
  invoiceCommitment: string | null;
  businessId: string | null;
  payer: string | null;
  amount: bigint | null;
  ledger: number;
  ledgerClosedAt: Date;
  rail: SettlementRail;
  railRefs: {
    sourceDomain: number | null;
    sourceTxHash: string | null;
    payerSentAt: Date | null;
    mintTxHash: string | null;
  };
  evidenceLevel: EvidenceLevel;
  qualification: SettlementQualification;
  allocatedAmount: bigint;
  refundedAmount: bigint;
  appliedAllocationIds: string[];
  appliedAdjustmentIds: string[];
  evidenceVersion: number;
  issuer: "olio";
  createdAt: Date;
  updatedAt: Date;
};

export type SettlementAllocationDoc = {
  _id: string;
  settlementId: string;
  invoiceId: string;
  invoiceVersion: number;
  amount: bigint;
  createdAt: Date;
  appliedAt: Date | null;
  reversedAt: Date | null;
  reversalReason: string | null;
};

export type SettlementAdjustmentDoc = {
  _id: string;
  settlementId: string;
  businessId: string;
  kind: "refund";
  amount: bigint;
  withdrawTxHash: string;
  nullifier: string;
  dest: string;
  recordedBy: string;
  verifiedAt: Date;
};

export type BusinessKeyDoc = {
  _id: string;
  businessId: string;
  generation: number;
  notePubkey: string;
  viewPubkey: string;
  activeFromLedger: number;
  activeToLedger: number | null;
  source: "bind" | "relay" | "sync";
  recordedAt: Date;
};

export type EvidenceEpochDoc = {
  _id: string;
  network: StellarNetworkName;
  poolId: string;
  epoch: number;
  manifestHash: string;
  anchorState: "pending" | "submitted" | "confirmed";
  anchorTxHash: string | null;
  issuedAt: Date;
};

export type EvidenceKeyDoc = {
  _id: string;
  publicKey: string;
  validFrom: Date;
  validTo: Date | null;
};

export type BusinessType = "individual" | "company";
export type BusinessLifecycle = "active" | "suspended" | "closed";

export type BusinessProfileDoc = {
  _id: string;
  publicId: string;
  type: BusinessType;
  lifecycle: BusinessLifecycle;
  displayName: string | null;
  username: string | null;
  boundAccount: string | null;
  boundAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type BusinessRole = "owner" | "admin" | "member";

export type BusinessMembershipDoc = {
  _id: string;
  businessId: string;
  privyUserId: string;
  role: BusinessRole;
  createdAt: Date;
};

export type VerificationEnvironment = "sandbox" | "live";

export type ProviderReviewStatus =
  | "init"
  | "pending"
  | "prechecked"
  | "queued"
  | "completed"
  | "onHold"
  | "awaitingUser"
  | "awaitingService";

export type EligibilityState =
  | "not_started"
  | "pending"
  | "needs_information"
  | "manual_review"
  | "approved"
  | "declined";

export type ProviderSnapshot = {
  applicantType: BusinessType;
  levelName: string | null;
  sandboxMode: boolean | null;
  reviewStatus: ProviderReviewStatus | null;
  reviewAnswer: "GREEN" | "RED" | null;
  rejectType: "FINAL" | "RETRY" | null;
  rejectLabels: string[];
  moderationComment: string | null;
  evidenceComplete: boolean;
  pendingEvidence: string[];
  associatedPersons: {
    applicantId: string;
    role: string;
    reviewStatus: ProviderReviewStatus | null;
    reviewAnswer: "GREEN" | "RED" | null;
  }[];
  applicantCreatedAt: string | null;
  checkedAt: Date;
};

export type VerificationDelivery = {
  id: string;
  kind: EligibilityState | "submitted";
  at: Date;
};

export type VerificationCaseDoc = {
  firstSubmittedAt?: Date | null;
  notificationOutbox?: VerificationDelivery[];
  _id: string;
  businessId: string;
  provider: "sumsub";
  environment: VerificationEnvironment;
  externalUserId: string;
  applicantId: string | null;
  applicantType: BusinessType;
  levelName: string;
  reviewCycle: number;
  eligibility: EligibilityState;
  userMessage: string | null;
  internalReasons: string[];
  snapshot: ProviderSnapshot | null;
  policyVersion: number;
  providerCheckedAt: Date | null;
  revision: number;
  reconcileAt: Date;
  lastEventAt: Date | null;
  leaseOwner?: string;
  leaseUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type VerificationEventDoc = {
  _id: string;
  provider: "sumsub";
  environment: VerificationEnvironment;
  externalUserId: string | null;
  applicantId: string | null;
  type: string;
  reviewStatus: string | null;
  reviewAnswer: string | null;
  providerCreatedAt: string | null;
  correlationId: string | null;
  state: "queued" | "done" | "parked";
  attempts: number;
  nextAttemptAt: Date;
  leaseOwner?: string;
  leaseUntil?: Date;
  lastError?: string;
  caseId?: string;
  receivedAt: Date;
  processedAt?: Date;
};

export type VerificationAuditDoc = {
  _id: string;
  actor: string;
  action: string;
  caseId: string | null;
  businessId: string;
  fromRevision: number | null;
  toRevision: number | null;
  reasonCode: string;
  at: Date;
};

export type IdentityCredentialDoc = {
  _id: string;
  businessId: string;
  environment: VerificationEnvironment;
  caseId: string;
  caseRevision: number;
  issuer: "olio";
  policyVersion: number;
  checkedAt: Date;
  validUntil: Date;
  status: "active" | "suspended";
  suspensionReason: string | null;
  published: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VerificationCoordinationDoc = {
  _id: string;
  owner?: string;
  until?: Date;
  count?: number;
  expiresAt?: Date;
};

export type UserDoc = {
  _id: string; // Olio C-address
  privyUserId: string;
  privyWalletId: string;
  privyWalletAddress: string;
  encryptedMaster?: Binary;
  masterSalt?: Binary;
  kdfParams?: { m: number; t: number; p: number };
  escrowRevision?: number;
  priorEscrows?: PriorEscrowDoc[];
  createdAt: Date;
  updatedAt: Date;
};

export type PriorEscrowDoc = {
  generation: number;
  encryptedSecrets: Binary;
  salt: Binary;
  kdfParams: { m: number; t: number; p: number };
  notePubkey: string;
  retiredAt: Date;
};

declare global {
  // eslint-disable-next-line no-var
  var _olioMongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | undefined;

const mongoClientOptions = {
  // Fail readiness and request paths promptly during an outage instead of
  // leaving checkout requests parked for the driver's 30-second default.
  serverSelectionTimeoutMS: 8_000,
  connectTimeoutMS: 8_000,
};

function getClient(): Promise<MongoClient> {
  if (clientPromise) return clientPromise;

  const serverEnv = getServerEnv();
  const configuredUri = serverEnv.MONGODB_URI;
  if (serverEnv.NODE_ENV === "production" && !configuredUri) {
    throw new Error("MONGODB_URI must be configured in production.");
  }
  const uri = configuredUri || "mongodb://localhost:27017/olio";

  if (serverEnv.NODE_ENV === "development") {
    // Reuse the connection across HMR reloads in dev.
    if (!global._olioMongoClientPromise) {
      global._olioMongoClientPromise = new MongoClient(
        uri,
        mongoClientOptions,
      ).connect();
    }
    clientPromise = global._olioMongoClientPromise;
  } else {
    clientPromise = new MongoClient(uri, mongoClientOptions).connect();
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(); // resolves db name from the URI path (`olio`)
}

export function poolCollectionName(
  baseName: string,
  scope = getServerEnv().MONGO_POOL_STORAGE_SCOPE,
): string {
  return scope ? `${baseName}__${scope}` : baseName;
}

export async function getDeposits(): Promise<Collection<DepositDoc>> {
  return (await getDb()).collection<DepositDoc>(poolCollectionName("deposits"));
}

export async function getUsernames(): Promise<Collection<UsernameDoc>> {
  return (await getDb()).collection<UsernameDoc>("usernames");
}

export async function getIndexerState(): Promise<Collection<IndexerStateDoc>> {
  return (await getDb()).collection<IndexerStateDoc>(
    poolCollectionName("indexer_state"),
  );
}

export async function getSpentNullifiers(): Promise<
  Collection<SpentNullifierDoc>
> {
  return (await getDb()).collection<SpentNullifierDoc>(
    poolCollectionName("spent_nullifiers"),
  );
}

export async function getFees(): Promise<Collection<FeeDoc>> {
  return (await getDb()).collection<FeeDoc>(poolCollectionName("pool_fees"));
}

export async function getCctpRelays(): Promise<Collection<CctpRelayDoc>> {
  return (await getDb()).collection<CctpRelayDoc>(
    poolCollectionName("cctp_relays"),
  );
}

export async function getAsyncFeeQuoteContexts(): Promise<
  Collection<AsyncFeeQuoteContextDoc>
> {
  return (await getDb()).collection<AsyncFeeQuoteContextDoc>(
    poolCollectionName("async_fee_quote_contexts"),
  );
}

export async function getUsers(): Promise<Collection<UserDoc>> {
  return (await getDb()).collection<UserDoc>("users");
}

export async function getPaymentLinks(): Promise<Collection<PaymentLinkDoc>> {
  return (await getDb()).collection<PaymentLinkDoc>("payment_links");
}

export async function getBusinessProfiles(): Promise<
  Collection<BusinessProfileDoc>
> {
  return (await getDb()).collection<BusinessProfileDoc>("business_profiles");
}

export async function getBusinessMemberships(): Promise<
  Collection<BusinessMembershipDoc>
> {
  return (await getDb()).collection<BusinessMembershipDoc>(
    "business_memberships",
  );
}

export async function getVerificationCases(): Promise<
  Collection<VerificationCaseDoc>
> {
  return (await getDb()).collection<VerificationCaseDoc>("verification_cases");
}

export async function getVerificationEvents(): Promise<
  Collection<VerificationEventDoc>
> {
  return (await getDb()).collection<VerificationEventDoc>(
    "verification_events",
  );
}

export async function getVerificationAudit(): Promise<
  Collection<VerificationAuditDoc>
> {
  return (await getDb()).collection<VerificationAuditDoc>("verification_audit");
}

export async function getIdentityCredentials(): Promise<
  Collection<IdentityCredentialDoc>
> {
  return (await getDb()).collection<IdentityCredentialDoc>(
    "identity_credentials",
  );
}

export async function getVerificationCoordination(): Promise<
  Collection<VerificationCoordinationDoc>
> {
  return (await getDb()).collection<VerificationCoordinationDoc>(
    "verification_coordination",
  );
}

export type CctpSessionDoc = {
  _id: string;
  network: string;
  pool: string;
  quoteId: string;
  capabilityHash: string;
  encryptedContext: string;
  sourceDomain: number;
  sourceTxHash?: string;
  sourceMessageId?: string;
  sourceScanBlock?: string;
  stage:
    | "awaiting_signature"
    | "submission_unknown"
    | "source_submitted"
    | "confirming_source"
    | "awaiting_attestation"
    | "minting"
    | "minted"
    | "depositing"
    | "completed"
    | "needs_attention";
  paymentAmount: string;
  feeAmount: string;
  totalAmount: string;
  result?: {
    leafIndex: number;
    paymentAmount: string;
    feeAmount: string;
    totalAmount: string;
    feePolicyVersion: number;
    txHash: string;
  };
  errorCode?: string;
  attempts: number;
  nextAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
  leaseOwner?: string;
  leaseUntil?: Date;
  requeuedAt?: Date;
  solanaBlockhash?: string;
  solanaLastValidBlockHeight?: number;
};
export async function getCctpSessions(): Promise<Collection<CctpSessionDoc>> {
  return (await getDb()).collection<CctpSessionDoc>(
    poolCollectionName("cctp_sessions"),
  );
}

const bigintCollection = { useBigInt64: true } as const;

export async function getWithdrawals(): Promise<Collection<WithdrawalDoc>> {
  return (await getDb()).collection<WithdrawalDoc>(
    poolCollectionName("withdrawals"),
    bigintCollection,
  );
}

export async function getPoolRoots(): Promise<Collection<PoolRootDoc>> {
  return (await getDb()).collection<PoolRootDoc>(
    poolCollectionName("pool_roots"),
  );
}

export async function getInvoices(): Promise<Collection<InvoiceDoc>> {
  return (await getDb()).collection<InvoiceDoc>("invoices", bigintCollection);
}

export async function getInvoiceVersions(): Promise<
  Collection<InvoiceVersionDoc>
> {
  return (await getDb()).collection<InvoiceVersionDoc>(
    "invoice_versions",
    bigintCollection,
  );
}

export async function getInvoiceEvents(): Promise<Collection<InvoiceEventDoc>> {
  return (await getDb()).collection<InvoiceEventDoc>(
    "invoice_events",
    bigintCollection,
  );
}

export async function getInvoiceCounters(): Promise<
  Collection<InvoiceCounterDoc>
> {
  return (await getDb()).collection<InvoiceCounterDoc>("invoice_counters");
}

export async function getPaymentIntents(): Promise<
  Collection<PaymentIntentDoc>
> {
  return (await getDb()).collection<PaymentIntentDoc>(
    "payment_intents",
    bigintCollection,
  );
}

export async function getQuoteContexts(): Promise<Collection<QuoteContextDoc>> {
  return (await getDb()).collection<QuoteContextDoc>(
    "quote_contexts",
    bigintCollection,
  );
}

export async function getSettlements(): Promise<Collection<SettlementDoc>> {
  return (await getDb()).collection<SettlementDoc>(
    "settlements",
    bigintCollection,
  );
}

export async function getSettlementAllocations(): Promise<
  Collection<SettlementAllocationDoc>
> {
  return (await getDb()).collection<SettlementAllocationDoc>(
    "settlement_allocations",
    bigintCollection,
  );
}

export async function getSettlementAdjustments(): Promise<
  Collection<SettlementAdjustmentDoc>
> {
  return (await getDb()).collection<SettlementAdjustmentDoc>(
    "settlement_adjustments",
    bigintCollection,
  );
}

export async function getBusinessKeys(): Promise<Collection<BusinessKeyDoc>> {
  return (await getDb()).collection<BusinessKeyDoc>("business_keys");
}

export async function getEvidenceEpochs(): Promise<
  Collection<EvidenceEpochDoc>
> {
  return (await getDb()).collection<EvidenceEpochDoc>("evidence_epochs");
}

export async function getEvidenceKeys(): Promise<Collection<EvidenceKeyDoc>> {
  return (await getDb()).collection<EvidenceKeyDoc>("evidence_keys");
}
