// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { CctpOperationalError } from "../src/server/modules/cctp/cctp.errors";

const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), env: {} as Record<string, unknown> }));
vi.mock("../src/env.server", () => ({ getServerEnv: () => state.env }));
vi.mock("../src/server/modules/cctp/cctp.storage", () => ({
  digest: (value: string) => value,
  sharedBudget: async () => {},
  coordination: async () => ({
    findOne: async (filter: { _id: string; expiresAt?: { $gt: Date } }) => {
      const row = state.rows.get(filter._id);
      return row && (!filter.expiresAt || (row.expiresAt as Date) > filter.expiresAt.$gt) ? row : null;
    },
    updateOne: async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => { state.rows.set(filter._id, update.$set); },
  }),
}));
import { checkSourceNetwork } from "../src/server/modules/cctp/cctp.rpc";

const rpc = (result: unknown) => vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } }));

describe("source network identity check", () => {
  afterEach(() => { state.rows.clear(); vi.unstubAllGlobals(); });

  it("accepts the full Solana devnet genesis hash", async () => {
    vi.stubGlobal("fetch", rpc("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"));
    await expect(checkSourceNetwork(5)).resolves.toBeUndefined();
    expect(state.rows.has("rpc:network:5:https://api.devnet.solana.com")).toBe(true);
  });

  it("rejects an endpoint serving a different Solana cluster", async () => {
    vi.stubGlobal("fetch", rpc("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"));
    await expect(checkSourceNetwork(5)).rejects.toMatchObject({ code: "configuration" } satisfies Partial<CctpOperationalError>);
  });

  it("accepts the Base Sepolia chain id", async () => {
    vi.stubGlobal("fetch", rpc("0x14a34"));
    await expect(checkSourceNetwork(6)).resolves.toBeUndefined();
  });
});
