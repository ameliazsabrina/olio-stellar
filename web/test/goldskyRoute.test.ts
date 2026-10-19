// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/goldsky-pool-events.json";

const mocks = vi.hoisted(() => ({
  env: { GOLDSKY_WEBHOOK_SECRET: "s3cret" } as Record<string, unknown>,
  rawBulkWrite: vi.fn(),
  stateUpdateOne: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../src/env.server", () => ({ getServerEnv: () => mocks.env }));
vi.mock("../src/lib/stellar", () => ({
  poolId: "CADINKLIUO3FNKFNP3DJW43BSBGXDWCCISQVR5GBWJ6YBTHB5TBB6FLU",
}));
vi.mock("../src/server/db/mongo", () => ({
  getRawPoolEvents: vi.fn(async () => ({ bulkWrite: mocks.rawBulkWrite })),
  getIndexerState: vi.fn(async () => ({ updateOne: mocks.stateUpdateOne })),
}));

import { POST } from "../src/app/api/goldsky/pool-events/route";
import { MAX_GOLDSKY_BATCH_BYTES } from "../src/server/modules/goldsky/goldsky.webhook";

const URL = "http://localhost/api/goldsky/pool-events";
const AUTH = "Bearer s3cret";

// A request whose body access is observable, to prove auth runs first.
function spyRequest(headers: Record<string, string>) {
  const bodyRead = vi.fn();
  const request = {
    headers: new Headers(headers),
    get body() {
      bodyRead();
      return null;
    },
    arrayBuffer: bodyRead,
    text: bodyRead,
    json: bodyRead,
    blob: bodyRead,
    formData: bodyRead,
  } as unknown as Request;
  return { request, bodyRead };
}

// A chunked body with no content-length, like a streaming sender.
function streamedRequest(chunks: number, chunkBytes: number) {
  let sent = 0;
  const pulled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled();
      if (sent >= chunks) return controller.close();
      sent += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
  });
  const request = new Request(URL, {
    method: "POST",
    headers: { authorization: AUTH },
    body: stream,
    duplex: "half",
  } as RequestInit);
  return { request, pulled, sent: () => sent };
}

const post = (body: string, authorization = AUTH) =>
  POST(
    new Request(URL, {
      method: "POST",
      headers: { authorization },
      body,
    }),
  );

describe("POST /api/goldsky/pool-events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rawBulkWrite.mockReset();
    mocks.stateUpdateOne.mockReset();
    mocks.env = { GOLDSKY_WEBHOOK_SECRET: "s3cret" };
  });

  it("returns 401 for a wrong bearer without touching the body", async () => {
    const { request, bodyRead } = spyRequest({ authorization: "Bearer nope" });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(bodyRead).not.toHaveBeenCalled();
    const missing = spyRequest({});
    expect((await POST(missing.request)).status).toBe(401);
    expect(missing.bodyRead).not.toHaveBeenCalled();
  });

  it("returns 503 when disabled, without touching the body", async () => {
    mocks.env = {};
    const { request, bodyRead } = spyRequest({ authorization: AUTH });
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it("returns 503 when the server env cannot be read", async () => {
    mocks.env = new Proxy(
      {},
      {
        get() {
          throw new Error("bad env");
        },
      },
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { request, bodyRead } = spyRequest({ authorization: AUTH });
    expect((await POST(request)).status).toBe(503);
    expect(bodyRead).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("returns 413 for a declared oversized body without reading it", async () => {
    const { request, bodyRead } = spyRequest({
      authorization: AUTH,
      "content-length": String(MAX_GOLDSKY_BATCH_BYTES + 1),
    });
    expect((await POST(request)).status).toBe(413);
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it("returns 413 once a streamed body passes the cap, and stops reading", async () => {
    const chunkBytes = 1_000_000;
    const chunks = 20;
    const { request, sent } = streamedRequest(chunks, chunkBytes);
    expect(request.headers.get("content-length")).toBeNull();
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(sent()).toBeLessThan(chunks);
    expect(sent()).toBeLessThanOrEqual(
      Math.ceil(MAX_GOLDSKY_BATCH_BYTES / chunkBytes) + 2,
    );
    expect(mocks.rawBulkWrite).not.toHaveBeenCalled();
    expect(mocks.stateUpdateOne).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect(mocks.stateUpdateOne).not.toHaveBeenCalled();
  });

  it("returns 503 when the archive write throws", async () => {
    mocks.rawBulkWrite.mockRejectedValue(new Error("mongo down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(JSON.stringify([fixture.cases[0].row]));
    expect(response.status).toBe(503);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("archives an authorized batch and returns 200", async () => {
    const response = await post(
      JSON.stringify([...fixture.cases.map((c) => c.row), fixture.heartbeat]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      received: true,
      outcome: "stored",
      events: fixture.cases.length,
      heartbeats: 1,
      ignored: 0,
      rejected: 0,
    });
  });

  it("accepts a streamed body under the cap", async () => {
    const rows = JSON.stringify([fixture.cases[2].row]);
    const bytes = new TextEncoder().encode(rows);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    const response = await POST(
      new Request(URL, {
        method: "POST",
        headers: { authorization: AUTH },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ events: 1 });
  });
});
