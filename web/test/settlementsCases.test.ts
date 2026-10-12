import { describe, expect, it, vi } from "vitest";

type CasesModule = {
  run: (
    argv: string[],
    db: unknown,
    env: Record<string, string>,
    out: (line: string) => void,
    fetchImpl?: typeof fetch,
  ) => Promise<number>;
  poolContext: (env: Record<string, string>) => {
    poolId: string;
    suffix: string;
    network: string;
  };
};

async function load(): Promise<CasesModule> {
  return (await import(
    new URL("../scripts/settlements-cases.mjs", import.meta.url).href
  )) as CasesModule;
}

const env = {
  NEXT_PUBLIC_OLIO_POOL_ID: "CPOOL",
  MONGO_POOL_STORAGE_SCOPE: "CPOOL",
};

function fakeDb() {
  const inserted: unknown[] = [];
  const collection = () => ({
    findOne: vi.fn(async () => null),
    insertOne: vi.fn(async (doc: unknown) => {
      inserted.push(doc);
    }),
  });
  return { db: { collection }, inserted };
}

describe("settlements operator CLI", () => {
  it("offers no way to mark anything paid", async () => {
    const { run } = await load();
    const out = vi.fn();
    const code = await run(["mark-paid", "7"], fakeDb().db, env, out);
    expect(code).toBe(2);
    expect(out.mock.calls[0][0]).toContain("no command to mark anything paid");
  });

  it("scopes collections to the configured pool", async () => {
    const { poolContext } = await load();
    expect(poolContext(env)).toEqual({
      poolId: "CPOOL",
      suffix: "__CPOOL",
      network: "testnet",
    });
  });

  it("audits a single-leaf rerun request", async () => {
    const { run } = await load();
    const { db, inserted } = fakeDb();
    const fetchImpl = vi.fn(
      async () => new Response('{"status":"reconciled"}', { status: 200 }),
    );
    const code = await run(
      ["rerun", "4", "--reason=payer support ticket"],
      db,
      { ...env, CRON_SECRET: "secret", SETTLEMENTS_OPERATOR: "ops" },
      vi.fn(),
      fetchImpl as unknown as typeof fetch,
    );
    expect(code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/api/cron/settlements-reconcile?leaf=4",
      expect.objectContaining({ method: "POST" }),
    );
    expect(inserted[0]).toMatchObject({
      actor: "operator:ops",
      action: "operator.settlement_rerun",
      reasonCode: "payer support ticket",
    });
  });
});
