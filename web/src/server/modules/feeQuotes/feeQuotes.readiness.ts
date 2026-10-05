import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  nativeToScVal,
  rpc,
  StrKey,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { Db } from "mongodb";
import { env } from "../../../env";
import { getServerEnv } from "../../../env.server-schema";
import { getDb, poolCollectionName } from "../../db/mongo";
import { FeeQuoteReadinessError } from "./feeQuotes.errors";

export type PaymentChannel = "direct" | "cctp";

export type ReadinessCode =
  | "NETWORK_MISMATCH"
  | "RPC_UNREACHABLE"
  | "ASSET_CONFIG_INVALID"
  | "POOL_CONFIG_MISSING"
  | "POOL_ABI_INCOMPATIBLE"
  | "POOL_FEE_CONFIG_MALFORMED"
  | "SIGNER_MISSING"
  | "SIGNER_INVALID"
  | "SIGNER_MISMATCH"
  | "REGISTRY_CONFIG_MISSING"
  | "REGISTRY_ABI_INCOMPATIBLE"
  | "INTAKE_CONFIG_MISSING"
  | "INTAKE_ABI_INCOMPATIBLE"
  | "INTAKE_CONFIG_MISMATCH"
  | "CCTP_OPERATOR_MISSING"
  | "CCTP_OPERATOR_INVALID"
  | "CCTP_OPERATOR_MISMATCH"
  | "MONGODB_UNAVAILABLE"
  | "MONGODB_INDEX_MISSING"
  | "INDEXER_NOT_READY"
  | "CCTP_SESSIONS_NEED_ATTENTION";

export type ReadinessDiagnostic = {
  code: ReadinessCode;
  severity: "blocker" | "warning";
  channels: PaymentChannel[];
  message: string;
};

export type ReadinessReport = {
  checkedAt: string;
  network: string;
  ready: boolean;
  channels: Record<PaymentChannel, { ready: boolean }>;
  diagnostics: ReadinessDiagnostic[];
};

type PublicConfiguration = Pick<
  typeof env,
  | "NEXT_PUBLIC_STELLAR_NETWORK"
  | "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE"
  | "NEXT_PUBLIC_STELLAR_RPC_URL"
  | "NEXT_PUBLIC_STELLAR_HORIZON_URL"
  | "NEXT_PUBLIC_OLIO_REGISTRY_ID"
  | "NEXT_PUBLIC_OLIO_POOL_ID"
  | "NEXT_PUBLIC_USDC_SAC_ID"
  | "NEXT_PUBLIC_USDC_ISSUER"
  | "NEXT_PUBLIC_CCTP_INTAKE_CONTRACT"
>;

type ServerConfiguration = ReturnType<typeof getServerEnv>;

export type ReadinessDependencies = {
  publicConfig?: PublicConfiguration;
  serverConfig?: ServerConfiguration;
  checkRpc?: () => Promise<void>;
  simulate?: (
    contractId: string,
    method: string,
    args?: ReturnType<typeof nativeToScVal>[],
  ) => Promise<unknown>;
  getDatabase?: () => Promise<Db>;
  refreshIndexer?: () => Promise<unknown>;
};

const ALL_CHANNELS: PaymentChannel[] = ["direct", "cctp"];
const INDEXER_STALE_AFTER_MS = 120_000;
const REQUIRED_INDEXES: Readonly<Record<string, readonly string[]>> = {
  pool_fees: ["fee_quote_id"],
  client_fee_policies: ["active_effective_policy", "policy_audit_order"],
  cctp_relays: ["relay_state_lease", "relay_quote_id"],
  async_fee_quote_contexts: ["async_quote_expiry"],
};

function diagnostic(
  diagnostics: ReadinessDiagnostic[],
  code: ReadinessCode,
  channels: PaymentChannel[],
  message: string,
  severity: ReadinessDiagnostic["severity"] = "blocker",
): void {
  diagnostics.push({ code, severity, channels, message });
}

function bytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function addressString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Address) return value.toString();
  return null;
}

function numberList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const result = value.map(Number);
  return result.every(Number.isSafeInteger) ? result : null;
}

function defaultRpcCheck(config: PublicConfiguration): () => Promise<void> {
  return async () => {
    const rpcUrl =
      config.NEXT_PUBLIC_STELLAR_RPC_URL ||
      (config.NEXT_PUBLIC_STELLAR_NETWORK === "testnet"
        ? "https://soroban-testnet.stellar.org"
        : "");
    if (!rpcUrl) throw new Error("missing RPC URL");
    const server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
    const health = await server.getHealth();
    if (health.status !== "healthy") throw new Error("RPC is not healthy");
  };
}

function defaultSimulate(
  config: PublicConfiguration,
): NonNullable<ReadinessDependencies["simulate"]> {
  return async (contractId, method, args = []) => {
    const rpcUrl =
      config.NEXT_PUBLIC_STELLAR_RPC_URL ||
      (config.NEXT_PUBLIC_STELLAR_NETWORK === "testnet"
        ? "https://soroban-testnet.stellar.org"
        : "");
    if (!rpcUrl) throw new Error("missing RPC URL");
    const server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
    const source = new Account(Keypair.random().publicKey(), "0");
    const transaction = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: config.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(60)
      .build();
    const result = await server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(result)) throw new Error("simulation failed");
    return result.result?.retval ? scValToNative(result.result.retval) : null;
  };
}

async function checkDatabase(
  database: Db,
  poolId: string,
  storageScope: string | undefined,
  diagnostics: ReadinessDiagnostic[],
): Promise<void> {
  const missing: string[] = [];
  for (const [collectionName, required] of Object.entries(REQUIRED_INDEXES)) {
    const resolvedCollectionName =
      collectionName === "client_fee_policies"
        ? collectionName
        : poolCollectionName(collectionName, storageScope);
    let names: Set<string>;
    try {
      names = new Set(
        (
          await database
            .collection(resolvedCollectionName)
            .listIndexes()
            .toArray()
        ).map((index) => index.name),
      );
    } catch {
      names = new Set();
    }
    for (const name of required) {
      if (!names.has(name)) missing.push(`${resolvedCollectionName}.${name}`);
    }
  }
  if (missing.length > 0) {
    diagnostic(
      diagnostics,
      "MONGODB_INDEX_MISSING",
      ALL_CHANNELS,
      `Required MongoDB indexes are missing (${missing.join(", ")}).`,
    );
  }
  const state = await database
    .collection<{
      _id: string;
      poolId?: string;
      health?: string;
      nullifiersComplete?: boolean;
      publishedLedger?: number;
      indexedAt?: Date;
    }>(poolCollectionName("indexer_state", storageScope))
    .findOne({ _id: "pool" });
  const needsAttention = await database
    .collection(poolCollectionName("cctp_sessions", storageScope))
    .countDocuments({ stage: "needs_attention" });
  if (needsAttention > 0) {
    diagnostic(
      diagnostics,
      "CCTP_SESSIONS_NEED_ATTENTION",
      ["cctp"],
      `${needsAttention} cross-chain payment session(s) need operator attention.`,
      "warning",
    );
  }
  if (
    !state ||
    state.poolId !== poolId ||
    state.health !== "healthy" ||
    state.nullifiersComplete === false ||
    typeof state.publishedLedger !== "number" ||
    !(state.indexedAt instanceof Date) ||
    Date.now() - state.indexedAt.getTime() > INDEXER_STALE_AFTER_MS
  ) {
    diagnostic(
      diagnostics,
      "INDEXER_NOT_READY",
      ALL_CHANNELS,
      "The configured pool indexer has not published a complete healthy watermark.",
    );
  }
}

export async function checkFeeQuoteReadiness(
  dependencies: ReadinessDependencies = {},
): Promise<ReadinessReport> {
  const publicConfig = dependencies.publicConfig ?? env;
  const serverConfig = dependencies.serverConfig ?? getServerEnv();
  const simulate = dependencies.simulate ?? defaultSimulate(publicConfig);
  const diagnostics: ReadinessDiagnostic[] = [];
  const expectedPassphrase =
    publicConfig.NEXT_PUBLIC_STELLAR_NETWORK === "testnet"
      ? Networks.TESTNET
      : Networks.PUBLIC;

  const knownEndpointMismatch =
    (publicConfig.NEXT_PUBLIC_STELLAR_NETWORK === "testnet" &&
      (/horizon\.stellar\.org/.test(
        publicConfig.NEXT_PUBLIC_STELLAR_HORIZON_URL,
      ) ||
        Boolean(
          publicConfig.NEXT_PUBLIC_STELLAR_RPC_URL?.includes("soroban-mainnet"),
        ))) ||
    (publicConfig.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" &&
      (publicConfig.NEXT_PUBLIC_STELLAR_HORIZON_URL.includes("testnet") ||
        Boolean(
          publicConfig.NEXT_PUBLIC_STELLAR_RPC_URL?.includes("testnet"),
        )));
  if (
    publicConfig.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE !==
      expectedPassphrase ||
    knownEndpointMismatch
  ) {
    diagnostic(
      diagnostics,
      "NETWORK_MISMATCH",
      ALL_CHANNELS,
      "Configured Stellar network and passphrase do not agree.",
    );
  }

  let rpcAvailable = true;
  await Promise.all([
    (dependencies.checkRpc ?? defaultRpcCheck(publicConfig))().catch(() => {
      rpcAvailable = false;
      diagnostic(
        diagnostics,
        "RPC_UNREACHABLE",
        ALL_CHANNELS,
        "Stellar RPC is unavailable.",
      );
    }),
  ]);

  const asset = publicConfig.NEXT_PUBLIC_USDC_SAC_ID;
  let expectedAsset: string | null = null;
  try {
    if (publicConfig.NEXT_PUBLIC_USDC_ISSUER) {
      expectedAsset = new Asset(
        "USDC",
        publicConfig.NEXT_PUBLIC_USDC_ISSUER,
      ).contractId(expectedPassphrase);
    }
  } catch {
    expectedAsset = null;
  }
  if (
    !asset ||
    !StrKey.isValidContract(asset) ||
    !publicConfig.NEXT_PUBLIC_USDC_ISSUER ||
    !StrKey.isValidEd25519PublicKey(publicConfig.NEXT_PUBLIC_USDC_ISSUER) ||
    expectedAsset !== asset
  ) {
    diagnostic(
      diagnostics,
      "ASSET_CONFIG_INVALID",
      ALL_CHANNELS,
      "The configured Stellar USDC asset is incomplete or invalid.",
    );
  }

  let signer: Keypair | null = null;
  if (!serverConfig.FEE_QUOTE_SIGNING_SECRET) {
    diagnostic(
      diagnostics,
      "SIGNER_MISSING",
      ALL_CHANNELS,
      "The dedicated fee quote signer is not configured.",
    );
  } else {
    try {
      signer = Keypair.fromSecret(serverConfig.FEE_QUOTE_SIGNING_SECRET);
    } catch {
      diagnostic(
        diagnostics,
        "SIGNER_INVALID",
        ALL_CHANNELS,
        "The dedicated fee quote signer is invalid.",
      );
    }
  }

  const pool = publicConfig.NEXT_PUBLIC_OLIO_POOL_ID;
  if (!pool || !StrKey.isValidContract(pool)) {
    diagnostic(
      diagnostics,
      "POOL_CONFIG_MISSING",
      ALL_CHANNELS,
      "A valid pool contract is not configured.",
    );
  } else if (rpcAvailable) {
    try {
      const [poolConfigValue, feeConfigValue] = await Promise.all([
        simulate(pool, "get_config"),
        simulate(pool, "fee_config"),
      ]);
      const poolConfig = poolConfigValue as Record<string, unknown> | null;
      const feeConfig = feeConfigValue as Record<string, unknown> | null;
      const allowed = numberList(feeConfig?.allowed_fee_bps);
      const onChainSigner = bytes(feeConfig?.signer);
      if (
        !poolConfig ||
        addressString(poolConfig.asset) !== asset ||
        !feeConfig ||
        Number(feeConfig.policy_version) !== 2 ||
        !allowed ||
        allowed.length !== 2 ||
        !allowed.includes(200) ||
        !allowed.includes(500) ||
        !onChainSigner ||
        onChainSigner.length !== 32 ||
        !addressString(feeConfig.recipient) ||
        !StrKey.isValidEd25519PublicKey(
          addressString(feeConfig.recipient) ?? "",
        )
      ) {
        diagnostic(
          diagnostics,
          "POOL_FEE_CONFIG_MALFORMED",
          ALL_CHANNELS,
          "The pool fee policy is missing or incompatible.",
        );
      } else if (
        signer &&
        !onChainSigner.every(
          (value, index) => value === signer.rawPublicKey()[index],
        )
      ) {
        diagnostic(
          diagnostics,
          "SIGNER_MISMATCH",
          ALL_CHANNELS,
          "The configured signer does not match the pool fee signer.",
        );
      }
    } catch {
      diagnostic(
        diagnostics,
        "POOL_ABI_INCOMPATIBLE",
        ALL_CHANNELS,
        "The configured pool does not expose the signed-fee ABI.",
      );
    }
  }

  const registry = publicConfig.NEXT_PUBLIC_OLIO_REGISTRY_ID;
  if (!registry || !StrKey.isValidContract(registry)) {
    diagnostic(
      diagnostics,
      "REGISTRY_CONFIG_MISSING",
      ALL_CHANNELS,
      "A valid username registry is not configured.",
    );
  } else if (rpcAvailable) {
    try {
      await simulate(registry, "username_of", [
        nativeToScVal(Keypair.random().publicKey(), { type: "address" }),
      ]);
    } catch {
      diagnostic(
        diagnostics,
        "REGISTRY_ABI_INCOMPATIBLE",
        ALL_CHANNELS,
        "The username registry ABI is incompatible.",
      );
    }
  }

  let cctpOperator: Keypair | null = null;
  if (!serverConfig.CCTP_OPERATOR_SECRET) {
    diagnostic(
      diagnostics,
      "CCTP_OPERATOR_MISSING",
      ["cctp"],
      "The CCTP relay operator is not configured.",
    );
  } else {
    try {
      cctpOperator = Keypair.fromSecret(serverConfig.CCTP_OPERATOR_SECRET);
    } catch {
      diagnostic(
        diagnostics,
        "CCTP_OPERATOR_INVALID",
        ["cctp"],
        "The CCTP relay operator is invalid.",
      );
    }
  }

  const intake = publicConfig.NEXT_PUBLIC_CCTP_INTAKE_CONTRACT;
  if (!intake || !StrKey.isValidContract(intake)) {
    diagnostic(
      diagnostics,
      "INTAKE_CONFIG_MISSING",
      ["cctp"],
      "A valid CCTP intake contract is not configured.",
    );
  } else if (pool && asset && rpcAvailable) {
    try {
      const value = (await simulate(intake, "config")) as Record<
        string,
        unknown
      > | null;
      if (
        !value ||
        addressString(value.pool) !== pool ||
        addressString(value.asset) !== asset
      ) {
        diagnostic(
          diagnostics,
          "INTAKE_CONFIG_MISMATCH",
          ["cctp"],
          "The CCTP intake does not target the configured pool and asset.",
        );
      } else if (
        cctpOperator &&
        addressString(value.admin) !== cctpOperator.publicKey()
      ) {
        diagnostic(
          diagnostics,
          "CCTP_OPERATOR_MISMATCH",
          ["cctp"],
          "The CCTP operator does not control the configured intake.",
        );
      }
    } catch {
      diagnostic(
        diagnostics,
        "INTAKE_ABI_INCOMPATIBLE",
        ["cctp"],
        "The configured CCTP intake ABI is incompatible.",
      );
    }
  }
  try {
    const database = await (dependencies.getDatabase ?? getDb)();
    let databaseDiagnostics: ReadinessDiagnostic[] = [];
    const inspectDatabase = () =>
      checkDatabase(
        database,
        pool ?? "",
        serverConfig.MONGO_POOL_STORAGE_SCOPE,
        databaseDiagnostics,
      );
    await inspectDatabase();
    if (
      dependencies.refreshIndexer &&
      rpcAvailable &&
      databaseDiagnostics.some((item) => item.code === "INDEXER_NOT_READY")
    ) {
      // Await a real sync, then re-read the watermark. A failed/degraded sync
      // must never bypass the completeness, pool identity, or freshness checks.
      await dependencies.refreshIndexer().catch(() => undefined);
      databaseDiagnostics = [];
      await inspectDatabase();
    }
    diagnostics.push(...databaseDiagnostics);
  } catch {
    diagnostic(
      diagnostics,
      "MONGODB_UNAVAILABLE",
      ALL_CHANNELS,
      "MongoDB readiness checks failed.",
    );
  }

  const channels = Object.fromEntries(
    ALL_CHANNELS.map((channel) => [
      channel,
      {
        ready: !diagnostics.some(
          (item) =>
            item.severity === "blocker" && item.channels.includes(channel),
        ),
      },
    ]),
  ) as ReadinessReport["channels"];
  return {
    checkedAt: new Date().toISOString(),
    network: publicConfig.NEXT_PUBLIC_STELLAR_NETWORK,
    ready: Object.values(channels).every((channel) => channel.ready),
    channels,
    diagnostics,
  };
}

let cached: { expiresAt: number; report: ReadinessReport } | null = null;

let readinessInFlight: Promise<ReadinessReport> | null = null;

export async function getCachedFeeQuoteReadiness(): Promise<ReadinessReport> {
  if (cached && cached.expiresAt > Date.now()) return cached.report;
  if (readinessInFlight) return readinessInFlight;
  readinessInFlight = checkFeeQuoteReadiness({
    refreshIndexer: async () => {
      const { syncPoolIndex } = await import("../deposits/deposits.service");
      return syncPoolIndex();
    },
  })
    .then((report) => {
      cached = { expiresAt: Date.now() + 30_000, report };
      return report;
    })
    .finally(() => {
      readinessInFlight = null;
    });
  return readinessInFlight;
}

export async function assertPaymentIngressReady(
  channel: PaymentChannel,
): Promise<void> {
  const report = await getCachedFeeQuoteReadiness();
  if (!report.channels[channel].ready) {
    throw new FeeQuoteReadinessError(
      report.diagnostics
        .filter(
          (item) =>
            item.severity === "blocker" && item.channels.includes(channel),
        )
        .map((item) => item.code),
    );
  }
}

export function resetReadinessCacheForTests(): void {
  if (process.env.NODE_ENV === "test") cached = null;
}
