import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rpcEvents from "./fixtures/ledger-5208266.rpc-events.json";

const POOL = "CADINKLIUO3FNKFNP3DJW43BSBGXDWCCISQVR5GBWJ6YBTHB5TBB6FLU";
const ledgerFile = (ledger: number) =>
  new Uint8Array(
    readFileSync(
      new URL(`./fixtures/ledger-${ledger}.xdr.zst`, import.meta.url),
    ),
  );
const LEDGERS: Record<number, Uint8Array> = {
  5208265: ledgerFile(5208265),
  5208266: ledgerFile(5208266),
};

const BUCKET = "https://aws-public-blockchain.s3.us-east-2.amazonaws.com";
const LAKE = `${BUCKET}/v1.1/stellar/ledgers/testnet/2025-12-18`;
const TESTNET = "Test SDF Network ; September 2015";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  datalakeDoc: null as Record<string, unknown> | null,
  rawRows: [] as Record<string, unknown>[],
  config: {} as Record<string, unknown>,
  fetch: vi.fn(),
}));

vi.mock("../src/env.server", () => ({ getServerEnv: () => mocks.env }));
vi.mock("../src/lib/stellar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/stellar")>()),
  poolId: "CADINKLIUO3FNKFNP3DJW43BSBGXDWCCISQVR5GBWJ6YBTHB5TBB6FLU",
  networkPassphrase: "Test SDF Network ; September 2015",
  stellarNetwork: "testnet",
}));
vi.mock("../src/server/db/mongo", () => ({
  getIndexerState: vi.fn(async () => ({
    findOne: async () => (mocks.datalakeDoc ? { ...mocks.datalakeDoc } : null),
    updateOne: async (
      _filter: unknown,
      update: { $set: Record<string, unknown>; $max: { lastLedger: number } },
    ) => {
      mocks.datalakeDoc = { ...mocks.datalakeDoc, ...update.$set };
    },
  })),
  getRawPoolEvents: vi.fn(async () => ({
    bulkWrite: async (
      ops: {
        updateOne: {
          filter: { _id: string };
          update: { $set: object; $setOnInsert: object };
        };
      }[],
    ) => {
      for (const { updateOne } of ops) {
        mocks.rawRows = mocks.rawRows.filter(
          (row) => row._id !== updateOne.filter._id,
        );
        mocks.rawRows.push({
          _id: updateOne.filter._id,
          ...updateOne.update.$set,
          ...updateOne.update.$setOnInsert,
        });
      }
    },
    find: (filter: { ledger: { $gt: number; $lt: number } }) => ({
      sort: () => ({
        toArray: async () =>
          mocks.rawRows
            .filter(
              (row) =>
                (row.ledger as number) > filter.ledger.$gt &&
                (row.ledger as number) < filter.ledger.$lt,
            )
            .sort((a, b) => String(a._id).localeCompare(String(b._id))),
      }),
    }),
  })),
}));

const response = (status: number, body?: BodyInit) =>
  new Response(body ?? null, { status });

function serveDataLake(url: string): Response {
  if (url.startsWith(`${BUCKET}/?list-type=2`)) {
    return response(
      200,
      [
        "v1.1/stellar/ledgers/testnet/",
        "v1.1/stellar/ledgers/testnet/2025-08-14/",
        "v1.1/stellar/ledgers/testnet/2025-12-18/",
      ]
        .map(
          (prefix) =>
            `<CommonPrefixes><Prefix>${prefix}</Prefix></CommonPrefixes>`,
        )
        .join(""),
    );
  }
  if (url === `${LAKE}/.config.json`) {
    return response(200, JSON.stringify(mocks.config));
  }
  const match =
    /\/FFB0E5FF--5184000-5247999\/[0-9A-F]{8}--(\d+)\.xdr\.zst$/.exec(url);
  const ledger = match && LEDGERS[Number(match[1])];
  return ledger ? response(200, ledger) : response(404);
}

async function load() {
  return {
    ledgers: await import("../src/server/modules/datalake/datalake.ledgers"),
    events: await import("../src/server/modules/datalake/datalake.events"),
  };
}

const ledgerUrls = () =>
  mocks.fetch.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.endsWith(".xdr.zst"));

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.env = { POOL_GAP_FILL_SOURCE: "datalake" };
  mocks.datalakeDoc = null;
  mocks.rawRows = [];
  mocks.config = {
    networkPassphrase: TESTNET,
    version: "1.0",
    compression: "zstd",
    ledgersPerBatch: 1,
    batchesPerPartition: 64000,
  };
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (url: string) => serveDataLake(url));
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("scanLedger", () => {
  it("extracts exactly the events RPC getEvents returns", async () => {
    const { ledgers } = await load();
    const scan = ledgers.scanLedger(LEDGERS[5208266], 5208266, POOL);
    expect(
      scan.events.map((event) => ({
        id: event.id,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt.toISOString().replace(".000", ""),
        txHash: event.txHash,
        topic: event.topics,
        value: event.value,
      })),
    ).toEqual(rpcEvents);
  });

  it("links consecutive ledgers by hash", async () => {
    const { ledgers } = await load();
    const parent = ledgers.scanLedger(LEDGERS[5208265], 5208265, POOL);
    const child = ledgers.scanLedger(LEDGERS[5208266], 5208266, POOL);
    expect(child.previousLedgerHash).toBe(parent.hash);
    expect(parent.events).toEqual([]);
  });

  it("rejects a file that holds another ledger", async () => {
    const { ledgers } = await load();
    expect(() => ledgers.scanLedger(LEDGERS[5208266], 5208265, POOL)).toThrow(
      /exactly ledger 5208265/,
    );
  });

  it("names objects like Galexie", async () => {
    const { ledgers } = await load();
    expect(ledgers.ledgerObjectKey(5326197, 64000)).toBe(
      "FFAEF1FF--5312000-5375999/FFAEBA8A--5326197.xdr.zst",
    );
  });
});

describe("addScannedRange", () => {
  it("joins adjacent ranges only when the hashes link", async () => {
    const { events } = await load();
    const a = { fromLedger: 1, toLedger: 10, prevHash: "p", toHash: "h10" };
    expect(
      events.addScannedRange([a], {
        fromLedger: 11,
        toLedger: 20,
        prevHash: "h10",
        toHash: "h20",
      }),
    ).toEqual([{ fromLedger: 1, toLedger: 20, prevHash: "p", toHash: "h20" }]);
    expect(
      events.addScannedRange([a], {
        fromLedger: 11,
        toLedger: 20,
        prevHash: "other",
        toHash: "h20",
      }),
    ).toHaveLength(2);
  });
});

describe("fillRetentionGap", () => {
  const future = () => Date.now() + 60_000;

  it("is off unless the source is datalake", async () => {
    mocks.env = { POOL_GAP_FILL_SOURCE: "off" };
    const { events } = await load();
    await expect(
      events.fillRetentionGap(5208264, 5208267, future()),
    ).resolves.toEqual({ events: null, reason: "off" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reads every ledger of the gap and returns its pool events", async () => {
    const { events } = await load();
    const fill = await events.fillRetentionGap(5208264, 5208267, future());
    expect(fill).toMatchObject({ fromLedger: 5208265, toLedger: 5208266 });
    expect(fill.events?.map((event) => event.id)).toEqual(
      rpcEvents.map((event) => event.id),
    );
    const { parseDepositEvent } = await import("../src/lib/stellar");
    const [deposit] = fill.events ?? [];
    expect(deposit && parseDepositEvent(deposit)).toBeTruthy();
    expect(ledgerUrls()).toHaveLength(2);
    expect(mocks.datalakeDoc?.scannedRanges).toEqual([
      expect.objectContaining({ fromLedger: 5208265, toLedger: 5208266 }),
    ]);
  });

  it("resumes after the recorded range instead of rereading it", async () => {
    const first = await load();
    await first.events.fillRetentionGap(5208264, 5208266, future());
    expect(ledgerUrls()).toEqual([
      expect.stringContaining("--5208265.xdr.zst"),
    ]);

    mocks.fetch.mockClear();
    const { events } = await load();
    const fill = await events.fillRetentionGap(5208264, 5208267, future());
    expect(ledgerUrls()).toEqual([
      expect.stringContaining("--5208266.xdr.zst"),
    ]);
    expect(fill.events).toHaveLength(2);
    expect(mocks.datalakeDoc?.scannedRanges).toHaveLength(1);
  });

  it("stops at the deadline and reports scanning", async () => {
    const { events } = await load();
    await expect(
      events.fillRetentionGap(5208264, 5208267, Date.now() - 1),
    ).resolves.toEqual({ events: null, reason: "scanning" });
    expect(ledgerUrls()).toEqual([]);
  });

  it("refuses a ledger the data lake does not hold", async () => {
    const { events } = await load();
    await expect(
      events.fillRetentionGap(5208265, 5208268, future()),
    ).resolves.toEqual({ events: null, reason: "ledger_missing" });
    expect(mocks.datalakeDoc).toBeNull();
  });

  it("refuses a scan that does not link onto a recorded range", async () => {
    mocks.datalakeDoc = {
      _id: "datalake",
      scannedRanges: [
        {
          fromLedger: 5208260,
          toLedger: 5208265,
          prevHash: "x",
          toHash: "not-the-parent",
        },
      ],
    };
    const { events } = await load();
    await expect(
      events.fillRetentionGap(5208264, 5208267, future()),
    ).resolves.toEqual({ events: null, reason: "ledger_chain_broken" });
  });

  it("refuses a data lake for another network", async () => {
    mocks.config.networkPassphrase =
      "Public Global Stellar Network ; September 2015";
    const { events } = await load();
    await expect(
      events.fillRetentionGap(5208264, 5208267, future()),
    ).resolves.toEqual({ events: null, reason: "datalake_mismatch" });
  });

  it("uses POOL_DATALAKE_URL without listing the bucket", async () => {
    mocks.env.POOL_DATALAKE_URL = `${LAKE}/`;
    const { events } = await load();
    await events.fillRetentionGap(5208264, 5208267, future());
    expect(
      mocks.fetch.mock.calls.some(([url]) => String(url).includes("list-type")),
    ).toBe(false);
  });

  it("refuses when the data lake is unreachable", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    const { events } = await load();
    await expect(
      events.fillRetentionGap(5208264, 5208267, future()),
    ).resolves.toEqual({ events: null, reason: "datalake_unavailable" });
  });

  it("refuses a stored pool event its mirror parser rejects", async () => {
    const { events } = await load();
    await events.fillRetentionGap(5208264, 5208267, future());
    mocks.rawRows[0].value = "AAAAAwAAAAE=";
    await expect(
      events.fillRetentionGap(5208264, 5208267, future()),
    ).resolves.toEqual({ events: null, reason: "event_undecodable" });
  });
});
