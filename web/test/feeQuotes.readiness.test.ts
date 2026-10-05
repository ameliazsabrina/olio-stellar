// @vitest-environment node
import { Asset, Keypair, Networks, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { checkFeeQuoteReadiness } from "../src/server/modules/feeQuotes/feeQuotes.readiness";

const pool = StrKey.encodeContract(Buffer.alloc(32, 1));
const registry = StrKey.encodeContract(Buffer.alloc(32, 2));
const intake = StrKey.encodeContract(Buffer.alloc(32, 4));
const issuer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5)).publicKey();
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));
const asset = new Asset("USDC", issuer).contractId(Networks.TESTNET);

const publicConfig = {
  NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
  NEXT_PUBLIC_STELLAR_RPC_URL: "https://rpc.example.test",
  NEXT_PUBLIC_STELLAR_HORIZON_URL: "https://horizon.example.test",
  NEXT_PUBLIC_OLIO_REGISTRY_ID: registry,
  NEXT_PUBLIC_OLIO_POOL_ID: pool,
  NEXT_PUBLIC_USDC_SAC_ID: asset,
  NEXT_PUBLIC_USDC_ISSUER: issuer,
  NEXT_PUBLIC_CCTP_INTAKE_CONTRACT: intake,
} as const;

const serverConfig = {
  NODE_ENV: "test",
  FEE_QUOTE_SIGNING_SECRET: signer.secret(),
  CCTP_OPERATOR_SECRET: signer.secret(),
  CHANNELS_BASE_URL: "https://channels.example.test",
  CIRCLE_IRIS_URL: "https://iris.example.test",
  BRIDGE_FUNDING_XLM: "2.5",
};

const indexNames: Record<string, string[]> = {
  pool_fees: ["fee_quote_id"],
  client_fee_policies: ["active_effective_policy", "policy_audit_order"],
  cctp_relays: ["relay_state_lease", "relay_quote_id"],
  async_fee_quote_contexts: ["async_quote_expiry"],
};

function database(options?: {
  missingIndex?: boolean;
  wrongPool?: boolean;
  staleIndexer?: boolean;
  needsAttention?: number;
}) {
  return {
    collection(name: string) {
      return {
        countDocuments: async () =>
          name === "cctp_sessions" ? (options?.needsAttention ?? 0) : 0,
        listIndexes: () => ({
          toArray: async () =>
            (options?.missingIndex && name === "pool_fees"
              ? []
              : (indexNames[name] ?? [])
            ).map((indexName) => ({ name: indexName })),
        }),
        findOne: async () =>
          name === "indexer_state"
            ? {
                _id: "pool",
                poolId: options?.wrongPool ? registry : pool,
                health: "healthy",
                nullifiersComplete: true,
                publishedLedger: 123,
                indexedAt: options?.staleIndexer
                  ? new Date(Date.now() - 121_000)
                  : new Date(),
              }
            : null,
      };
    },
  };
}

function simulate(contractId: string, method: string): Promise<unknown> {
  if (contractId === pool && method === "get_config") {
    return Promise.resolve({ asset, depth: 20 });
  }
  if (contractId === pool && method === "fee_config") {
    return Promise.resolve({
      allowed_fee_bps: [200, 500],
      policy_version: 2,
      recipient: issuer,
      signer: signer.rawPublicKey(),
    });
  }
  if (contractId === intake && method === "config") {
    return Promise.resolve({ admin: signer.publicKey(), pool, asset });
  }
  if (contractId === registry && method === "username_of") {
    return Promise.resolve(null);
  }
  return Promise.reject(new Error("unexpected read"));
}

const healthyDependencies = {
  publicConfig,
  serverConfig,
  checkRpc: async () => undefined,
  simulate,
  getDatabase: async () => database() as never,
};

describe("fee quote readiness", () => {
  it("accepts a compatible paired deployment and healthy isolated database", async () => {
    const report = await checkFeeQuoteReadiness(healthyDependencies as never);
    expect(report.ready).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it("reports both a missing signer and the observed old pool ABI", async () => {
    const report = await checkFeeQuoteReadiness({
      ...healthyDependencies,
      serverConfig: {
        ...serverConfig,
        FEE_QUOTE_SIGNING_SECRET: undefined,
      },
      simulate: async (contractId, method) => {
        if (contractId === pool && method === "fee_config") {
          throw new Error("trying to invoke non-existent contract function");
        }
        return simulate(contractId, method);
      },
    } as never);
    expect(report.channels.direct.ready).toBe(false);
    expect(report.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["SIGNER_MISSING", "POOL_ABI_INCOMPATIBLE"]),
    );
  });

  it("fails closed when indexes or the configured pool watermark differ", async () => {
    const report = await checkFeeQuoteReadiness({
      ...healthyDependencies,
      getDatabase: async () =>
        database({ missingIndex: true, wrongPool: true }) as never,
    } as never);
    expect(report.channels.direct.ready).toBe(false);
    expect(report.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["MONGODB_INDEX_MISSING", "INDEXER_NOT_READY"]),
    );
  });

  it("fails closed when the indexer watermark is stale", async () => {
    const report = await checkFeeQuoteReadiness({
      ...healthyDependencies,
      getDatabase: async () => database({ staleIndexer: true }) as never,
    } as never);

    expect(report.channels.direct.ready).toBe(false);
    expect(report.diagnostics.map(({ code }) => code)).toContain(
      "INDEXER_NOT_READY",
    );
  });
  it("refreshes a stale index and verifies its newly published watermark", async () => {
    const state = { staleIndexer: true };
    const refreshIndexer = vi.fn(async () => {
      state.staleIndexer = false;
    });
    const report = await checkFeeQuoteReadiness({
      ...healthyDependencies,
      getDatabase: async () => database(state) as never,
      refreshIndexer,
    } as never);
    expect(refreshIndexer).toHaveBeenCalledOnce();
    expect(report.channels.direct.ready).toBe(true);
  });

  it.each([
    "rejected",
    "degraded",
    "wrong-pool",
  ])("keeps quoting blocked after a %s refresh", async (outcome) => {
    const refreshIndexer = vi.fn(async () => {
      if (outcome === "rejected") throw new Error("RPC unavailable");
      return { status: "degraded" };
    });
    const report = await checkFeeQuoteReadiness({
      ...healthyDependencies,
      getDatabase: async () =>
        database({
          staleIndexer: outcome !== "wrong-pool",
          wrongPool: outcome === "wrong-pool",
        }) as never,
      refreshIndexer,
    } as never);
    expect(refreshIndexer).toHaveBeenCalledOnce();
    expect(report.channels.direct.ready).toBe(false);
    expect(report.diagnostics.map(({ code }) => code)).toContain(
      "INDEXER_NOT_READY",
    );
  });

  it("does not refresh an already healthy index", async () => {
    const refreshIndexer = vi.fn();
    const report = await checkFeeQuoteReadiness({
      ...healthyDependencies,
      refreshIndexer,
    } as never);
    expect(report.ready).toBe(true);
    expect(refreshIndexer).not.toHaveBeenCalled();
  });

  it("surfaces parked CCTP sessions as a warning without closing the route", async () => {
    const report = await checkFeeQuoteReadiness({
      ...healthyDependencies,
      getDatabase: async () => database({ needsAttention: 2 }),
    } as never);
    expect(report.channels.cctp.ready).toBe(true);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "CCTP_SESSIONS_NEED_ATTENTION",
        severity: "warning",
        channels: ["cctp"],
      }),
    );
  });
});
