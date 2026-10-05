import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), budget: vi.fn(), lock: vi.fn(), fetch: vi.fn() }));
vi.mock("../src/server/modules/cctp/cctp.config", async importOriginal => ({ ...await importOriginal<typeof import("../src/server/modules/cctp/cctp.config")>(), assertCctpTestnet: () => {} }));
vi.mock("../src/server/modules/cctp/cctp.storage", () => ({
  digest: (s: string) => s,
  sharedBudget: state.budget,
  claimLock: state.lock,
  coordination: async () => ({
    findOne: async (filter: { _id: string; expiresAt?: { $gt: Date } }) => { const row = state.rows.get(filter._id); return row && (!filter.expiresAt || (row.expiresAt as Date) > filter.expiresAt.$gt) ? row : null; },
    updateOne: async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => { state.rows.set(filter._id, { ...state.rows.get(filter._id), ...update.$set }); },
  }),
}));
import { boundedJson, fetchIrisMessages, irisMessagesSchema, normalizeSourceIdentifier, retryAfter, selectIrisMessage, standardFee } from "../src/server/modules/cctp/iris.client";
const hash = `0x${"AB".repeat(32)}`;
beforeEach(() => {
  state.rows.clear(); vi.clearAllMocks(); vi.stubGlobal("fetch", state.fetch);
  state.budget.mockResolvedValue(undefined); state.lock.mockResolvedValue({ release: async () => {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("bounded Iris transport", () => {
  it("treats only message 404 as valid pending and caches it", async () => {
    state.fetch.mockResolvedValue(new Response("", { status: 404 }));
    expect(await fetchIrisMessages(0, hash)).toEqual([]);
    expect(await fetchIrisMessages(0, hash)).toEqual([]);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][0]).toContain(hash.toLowerCase());
  });
  it.each([[403, "denied"], [451, "denied"], [429, "throttled"], [500, "upstream"]])("classifies HTTP %s without a country-policy claim", async (status, code) => {
    state.fetch.mockResolvedValue(new Response("private upstream text", { status, headers: { "retry-after": "90" } }));
    await expect(fetchIrisMessages(0, hash)).rejects.toMatchObject({ code, retryAfterMs: 90_000 });
    await expect(fetchIrisMessages(0, hash)).rejects.toMatchObject({ code: code === "denied" ? "denied" : "throttled" });
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves a denial investigation flag after recovery succeeds", async () => {
    state.rows.set("iris:circuit:0", { denied: true, nextAt: new Date(0) });
    state.fetch.mockResolvedValue(Response.json({ messages: [] }));
    await fetchIrisMessages(0, hash);
    expect(state.rows.get("iris:circuit:0")?.denied).toBe(true);
  });
  it.each(["not json", JSON.stringify({ messages: [{ status: "complete", message: "bad" }] })])("rejects malformed payloads", async body => {
    state.fetch.mockResolvedValue(new Response(body));
    await expect(fetchIrisMessages(0, hash)).rejects.toMatchObject({ code: "malformed" });
  });
  it("rejects oversized streams and wrong-domain messages", async () => {
    await expect(boundedJson(new Response("123456789"), 4)).rejects.toMatchObject({ code: "malformed" });
    const bytes = Buffer.alloc(376); bytes.writeUInt32BE(6, 4);
    state.fetch.mockResolvedValue(Response.json({ messages: [{ status: "complete", message: `0x${bytes.toString("hex")}`, attestation: "0xaabb" }] }));
    await expect(fetchIrisMessages(0, hash)).rejects.toMatchObject({ code: "malformed" });
  });
  it("enforces a deadline on stalled fetches", async () => {
    vi.stubEnv("CCTP_IRIS_TIMEOUT_MS", "100");
    state.fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => reject(new Error("timeout"))); }));
    await expect(fetchIrisMessages(0, hash)).rejects.toMatchObject({ code: "timeout" });
  });
  it("classifies network transport failure and rejects arbitrary hosts before fetching", async () => {
    state.fetch.mockRejectedValue(new Error("DNS secret detail"));
    await expect(fetchIrisMessages(0, hash)).rejects.toMatchObject({ code: "transport" });
    vi.stubEnv("CIRCLE_IRIS_URL", "https://example.com");
    await expect(fetchIrisMessages(0, hash)).rejects.toMatchObject({ code: "configuration" });
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
  it("validates fees and exposes nonzero Standard fees for gating", async () => {
    state.fetch.mockResolvedValue(Response.json([{ finalityThreshold: 2000, minimumFee: 1 }]));
    expect(await standardFee(6)).toBe(1);
  });
  it("requires a unique matching candidate", () => {
    const messages = irisMessagesSchema.parse({ messages: [{ status: "complete", message: "0xaabb", attestation: "0xaabb" }, { status: "complete", message: "0xccdd", attestation: "0xaabb" }] }).messages;
    expect(selectIrisMessage(messages, m => m === "0xccdd")?.message).toBe("0xccdd");
    expect(() => selectIrisMessage(messages, () => true)).toThrow();
  });
  it("normalizes only EVM hashes and validates chain-specific identifier lengths", () => {
    const solana = "1".repeat(63) + "2";
    expect(normalizeSourceIdentifier(5, solana)).toBe(solana);
    expect(() => normalizeSourceIdentifier(0, solana)).toThrow();
    expect(() => normalizeSourceIdentifier(5, hash)).toThrow();
    expect(() => normalizeSourceIdentifier(999, hash)).toThrow();
    expect(retryAfter("120")).toBe(120_000);
    expect(retryAfter(new Date(180_000).toUTCString(), 60_000)).toBe(120_000);
  });
});
