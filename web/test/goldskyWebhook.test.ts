import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/goldsky-pool-events.json";

// The fixture's real testnet pool, so captured rows run through unchanged.
const POOL = "CADINKLIUO3FNKFNP3DJW43BSBGXDWCCISQVR5GBWJ6YBTHB5TBB6FLU";
const OTHER_POOL = `C${"B".repeat(55)}`;
const mocks = vi.hoisted(() => ({
  env: { GOLDSKY_WEBHOOK_SECRET: "s3cret" } as Record<string, unknown>,
  rawBulkWrite: vi.fn(),
  stateUpdateOne: vi.fn(),
}));

vi.mock("../src/env.server", () => ({ getServerEnv: () => mocks.env }));
vi.mock("../src/lib/stellar", () => ({
  poolId: "CADINKLIUO3FNKFNP3DJW43BSBGXDWCCISQVR5GBWJ6YBTHB5TBB6FLU",
}));
vi.mock("../src/server/db/mongo", () => ({
  getRawPoolEvents: vi.fn(async () => ({ bulkWrite: mocks.rawBulkWrite })),
  getIndexerState: vi.fn(async () => ({ updateOne: mocks.stateUpdateOne })),
}));

import {
  goldskyAuthorization,
  ingestGoldskyBatch,
  rpcEventId,
} from "../src/server/modules/goldsky/goldsky.webhook";

// Real Goldsky shape (Task 0): id = <ledger>-<txhash>-op-<N>-event-<M>,
// 0-based transaction_index, naive-UTC ledger_closed_at, _gs_op "i".
const event = (overrides: Record<string, unknown> = {}) => ({
  kind: "event",
  id: `100-${"a".repeat(64)}-op-0-event-1`,
  pool_id: POOL,
  contract_id: POOL,
  topics: '[{"symbol":"spend"}]',
  data: '{"bytes":"00"}',
  transaction_hash: "a".repeat(64),
  transaction_index: 0,
  ledger_sequence: 100,
  ledger_closed_at: "2026-10-16T00:00:00",
  _gs_op: "i",
  ...overrides,
});
// TOID(100, 0 + 1, 0) = (100 << 32) | (1 << 12)
const RPC_ID = "0000000429496733696-0000000001";
// A heartbeat is a marker event row from another contract (see the SQL in
// scripts/goldsky-pipeline.mjs), so it carries the event columns too.
const heartbeat = (
  ledger: number,
  overrides: Record<string, unknown> = {},
) => ({
  ...fixture.heartbeat,
  id: `${ledger}-${"f".repeat(64)}-op-0-event-0`,
  ledger_sequence: ledger,
  ...overrides,
});
const body = (rows: unknown) => Buffer.from(JSON.stringify(rows));
const AUTH = "Bearer s3cret";

describe("ingestGoldskyBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rawBulkWrite.mockReset();
    mocks.stateUpdateOne.mockReset();
    mocks.env = { GOLDSKY_WEBHOOK_SECRET: "s3cret" };
  });

  it("is disabled without a secret and rejects a wrong bearer", async () => {
    mocks.env = {};
    await expect(ingestGoldskyBatch(body([]), AUTH)).resolves.toEqual({
      outcome: "disabled",
    });
    mocks.env = { GOLDSKY_WEBHOOK_SECRET: "s3cret" };
    await expect(ingestGoldskyBatch(body([]), "Bearer nope")).resolves.toEqual({
      outcome: "unauthorized",
    });
    await expect(ingestGoldskyBatch(body([]), null)).resolves.toEqual({
      outcome: "unauthorized",
    });
    expect(mocks.rawBulkWrite).not.toHaveBeenCalled();
  });

  it("checks the bearer on its own, before any body is read", () => {
    mocks.env = {};
    expect(goldskyAuthorization(AUTH)).toBe("disabled");
    mocks.env = { GOLDSKY_WEBHOOK_SECRET: "s3cret" };
    expect(goldskyAuthorization(AUTH)).toBe("authorized");
    expect(goldskyAuthorization("Bearer nope")).toBe("unauthorized");
    expect(goldskyAuthorization("s3cret")).toBe("unauthorized");
    expect(goldskyAuthorization(null)).toBe("unauthorized");
  });

  it("reports an unparseable body as malformed", async () => {
    await expect(ingestGoldskyBatch(Buffer.from("{"), AUTH)).resolves.toEqual({
      outcome: "malformed",
    });
  });

  it("upserts pool events by id, skips other contracts, counts bad rows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await ingestGoldskyBatch(
      body([
        event(),
        event({
          id: `101-${"b".repeat(64)}-op-0-event-1`,
          contract_id: OTHER_POOL,
        }),
        { kind: "event", id: 1 },
        event({ id: "not-a-goldsky-id" }),
        heartbeat(160),
      ]),
      AUTH,
    );
    warn.mockRestore();
    expect(result).toEqual({
      outcome: "stored",
      events: 1,
      heartbeats: 1,
      ignored: 1,
      rejected: 2,
    });
    const [ops] = mocks.rawBulkWrite.mock.calls[0];
    expect(ops[0].updateOne.filter).toEqual({ _id: RPC_ID });
    expect(ops[0].updateOne.update.$set).toMatchObject({
      goldskyId: `100-${"a".repeat(64)}-op-0-event-1`,
      ledger: 100,
      txHash: "a".repeat(64),
      ledgerClosedAt: new Date("2026-10-16T00:00:00Z"),
    });
    expect(ops[0].updateOne.upsert).toBe(true);
    const [, update] = mocks.stateUpdateOne.mock.calls[0];
    expect(update.$max).toEqual({ lastLedger: 160, lastEventLedger: 100 });
    expect(update.$inc).toEqual({ rejectedRows: 2 });
  });

  it("archives the real captured rows under their RPC event ids", async () => {
    const result = await ingestGoldskyBatch(
      body([...fixture.cases.map((c) => c.row), fixture.heartbeat]),
      AUTH,
    );
    expect(result).toEqual({
      outcome: "stored",
      events: fixture.cases.length,
      heartbeats: 1,
      ignored: 0,
      rejected: 0,
    });
    const [ops] = mocks.rawBulkWrite.mock.calls[0];
    expect(
      ops.map(
        (op: { updateOne: { filter: { _id: string } } }) =>
          op.updateOne.filter._id,
      ),
    ).toEqual(fixture.cases.map((c) => c.expect.rpcEventId));
    for (const [index, c] of fixture.cases.entries()) {
      expect(ops[index].updateOne.update.$set).toMatchObject({
        goldskyId: c.row.id,
        ledger: c.row.ledger_sequence,
        txHash: c.row.transaction_hash,
        ledgerClosedAt: new Date(c.expect.ts),
        topics: c.row.topics,
        data: c.row.data,
      });
    }
    const [, update] = mocks.stateUpdateOne.mock.calls[0];
    expect(update.$max).toEqual({
      lastLedger: fixture.heartbeat.ledger_sequence,
      lastEventLedger: Math.max(
        ...fixture.cases.map((c) => c.row.ledger_sequence),
      ),
    });
  });

  // A pipeline left running for an old pool must not move the new pool's
  // watermark or write into its archive.
  it("ignores heartbeats and events tagged with another pool", async () => {
    const result = await ingestGoldskyBatch(
      body([
        heartbeat(600, { pool_id: OTHER_POOL }),
        event({ pool_id: OTHER_POOL }),
      ]),
      AUTH,
    );
    expect(result).toEqual({
      outcome: "stored",
      events: 0,
      heartbeats: 0,
      ignored: 2,
      rejected: 0,
    });
    expect(mocks.rawBulkWrite).not.toHaveBeenCalled();
    const [, update] = mocks.stateUpdateOne.mock.calls[0];
    expect(update.$max).toEqual({ lastLedger: 0, lastEventLedger: 0 });
    expect(update.$set.heartbeatAt).toBeUndefined();
  });

  it("rejects a heartbeat without a pool id", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pool_id: _omit, ...untagged } = heartbeat(600);
    const result = await ingestGoldskyBatch(body([untagged]), AUTH);
    warn.mockRestore();
    expect(result).toMatchObject({ heartbeats: 0, rejected: 1 });
    const [, update] = mocks.stateUpdateOne.mock.calls[0];
    expect(update.$max.lastLedger).toBe(0);
  });

  it("logs rejected rows once per batch with the issue path and row id, no payload", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ingestGoldskyBatch(
      body([
        event({ transaction_hash: "nothex" }),
        event({ id: `102-${"c".repeat(64)}-op-0-event-1`, ledger_sequence: 0 }),
        event(),
      ]),
      AUTH,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("2 rejected");
    expect(message).toContain("transaction_hash");
    expect(message).toContain("ledger_sequence");
    expect(message).toContain(`100-${"a".repeat(64)}-op-0-event-1`);
    expect(message).toContain("kind=event");
    expect(message).not.toContain('"symbol"');
    expect(message).not.toContain("nothex");
    warn.mockRestore();
  });

  it("does not log when every row is accepted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ingestGoldskyBatch(body([event(), heartbeat(120)]), AUTH);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rebuilds the RPC event id from ledger, transaction index, op and event", () => {
    // Verified against RPC ids on testnet in Task 0.
    expect(rpcEventId(4563479, 4, 0, 3)).toBe("0019599993061003264-0000000003");
    expect(rpcEventId(4618548, 11, 0, 2)).toBe(
      "0019836512615055360-0000000002",
    );
  });

  it("writes events before moving the watermark", async () => {
    const order: string[] = [];
    mocks.rawBulkWrite.mockImplementation(async () => order.push("events"));
    mocks.stateUpdateOne.mockImplementation(async () =>
      order.push("watermark"),
    );
    await ingestGoldskyBatch(body([event(), heartbeat(200)]), AUTH);
    expect(order).toEqual(["events", "watermark"]);
  });

  it("leaves the watermark alone when the event write fails", async () => {
    mocks.rawBulkWrite.mockRejectedValue(new Error("mongo down"));
    await expect(
      ingestGoldskyBatch(body([event(), heartbeat(200)]), AUTH),
    ).rejects.toThrow("mongo down");
    expect(mocks.stateUpdateOne).not.toHaveBeenCalled();
  });

  it("flags a delete instead of removing the archived row", async () => {
    await ingestGoldskyBatch(body([event({ _gs_op: "d" })]), AUTH);
    const [ops] = mocks.rawBulkWrite.mock.calls[0];
    expect(ops[0].updateOne.filter).toEqual({ _id: RPC_ID });
    expect(ops[0].updateOne.upsert).toBeUndefined();
    expect(ops[0].updateOne.update.$set.correctedAt).toBeInstanceOf(Date);
    const [, update] = mocks.stateUpdateOne.mock.calls[0];
    expect(update.$set.correctionAt).toBeInstanceOf(Date);
  });
});
