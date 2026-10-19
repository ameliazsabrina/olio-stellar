// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  diffEventIds,
  parityPassed,
  parityRange,
} from "../scripts/goldsky-parity.mjs";
import { renderPipeline } from "../scripts/goldsky-pipeline.mjs";

const POOL = `C${"A".repeat(55)}`;
const base = {
  network: "testnet",
  poolId: POOL,
  startLedger: 1234,
  webhookUrl: "https://olio.example/api/goldsky/pool-events",
  secretName: "OLIO_GOLDSKY_WEBHOOK",
};

describe("goldsky pipeline render", () => {
  it("filters to the pool on the right dataset from the start ledger", () => {
    const yaml = renderPipeline(base);
    expect(yaml).toContain("dataset_name: stellar_testnet.events");
    expect(yaml).toContain("start_at: 1234");
    expect(yaml).toContain(`contract_id = '${POOL}'`);
    expect(yaml).toContain("in_successful_contract_call = true");
    expect(yaml).toContain("transaction_index");
    expect(yaml).toContain("secret_name: OLIO_GOLDSKY_WEBHOOK");
  });

  // Heartbeats must come from the same stream and sink as the events, or the
  // watermark could run ahead of undelivered events.
  it("derives heartbeats from the events stream in one transform and one sink", () => {
    const yaml = renderPipeline(base);
    expect(yaml).not.toContain(".ledgers");
    expect(yaml).not.toMatch(/^ {2}ledgers:/m);
    expect(yaml).not.toContain("heartbeats");
    expect(yaml.match(/type: dataset/g)).toHaveLength(1);
    expect(yaml.match(/type: sql/g)).toHaveLength(1);
    expect(yaml.match(/type: webhook/g)).toHaveLength(1);
    expect(yaml).toContain("from: pool_rows");
    expect(yaml).toContain("primary_key: id");
    expect(yaml).toContain(
      `CASE WHEN contract_id = '${POOL}' THEN 'event' ELSE 'heartbeat' END AS kind`,
    );
    expect(yaml).toContain(`'${POOL}' AS pool_id`);
    expect(yaml).toContain(
      `ledger_sequence % 60 = 0 AND transaction_index = 0 AND contract_id <> '${POOL}'`,
    );
  });

  it("rejects bad inputs", () => {
    expect(() => renderPipeline({ ...base, network: "futurenet" })).toThrow(
      /network/,
    );
    expect(() => renderPipeline({ ...base, poolId: "GABC" })).toThrow(/pool/);
    expect(() => renderPipeline({ ...base, startLedger: 0 })).toThrow(
      /start ledger/,
    );
    expect(() => renderPipeline({ ...base, webhookUrl: "http://x" })).toThrow(
      /https/,
    );
  });
});

const topic = (kind: string) => JSON.stringify([{ symbol: kind }]);
const raw = (id: string, txHash: string, kind: string) => ({
  _id: id,
  txHash,
  topics: topic(kind),
});

describe("goldsky parity", () => {
  // A transaction carries several events (deposit + fee, spend + withdraw),
  // so matching by tx hash would hide a missing event inside a matched tx.
  it("diffs event ids, not transactions", () => {
    const diff = diffEventIds({
      archive: [raw("e1", "tx1", "deposit"), raw("e3", "tx2", "spend")],
      mirror: [
        { eventId: "e1", txHash: "tx1", kind: "deposit" },
        { eventId: "e2", txHash: "tx1", kind: "fee" },
        { eventId: "e3", txHash: "tx2", kind: "spend" },
      ],
    });
    expect(diff.missingFromArchive).toEqual(["e2"]);
    expect(diff.missingFromMirror).toEqual({});
    expect(diff.archiveEvents).toBe(2);
    expect(diff.mirrorEvents).toBe(3);
    expect(parityPassed(diff)).toBe(false);
  });

  it("groups archive-only events by topic and treats them as informational", () => {
    const diff = diffEventIds({
      archive: [
        raw("e1", "tx1", "deposit"),
        raw("p1", "tx9", "pause"),
        raw("g1", "tx8", "gov_set_admin"),
        raw("g2", "tx7", "gov_set_admin"),
        { _id: "x1", txHash: "tx6", topics: "not json" },
      ],
      mirror: [{ eventId: "e1", txHash: "tx1", kind: "deposit" }],
    });
    expect(diff.missingFromArchive).toEqual([]);
    expect(diff.missingFromMirror).toEqual({
      pause: ["p1"],
      gov_set_admin: ["g1", "g2"],
      unknown: ["x1"],
    });
    expect(parityPassed(diff)).toBe(true);
  });

  it("compares mirror docs without an event id by tx hash, counted apart", () => {
    const diff = diffEventIds({
      archive: [raw("e1", "tx1", "deposit"), raw("f1", "tx1", "fee")],
      mirror: [
        { txHash: "tx1", kind: "deposit" },
        { txHash: "tx5", kind: "deposit" },
        { eventId: "f1", txHash: "tx1", kind: "fee" },
      ],
    });
    expect(diff.missingFromArchive).toEqual([]);
    expect(diff.legacyByTxHash).toEqual({
      compared: 2,
      missingFromArchive: ["tx5"],
    });
    // The archive's deposit event in tx1 is the legacy mirror doc, not an
    // extra archive-only event.
    expect(diff.missingFromMirror).toEqual({});
    expect(parityPassed(diff)).toBe(false);

    const matched = diffEventIds({
      archive: [raw("e1", "tx1", "deposit")],
      mirror: [{ txHash: "tx1", kind: "deposit" }],
    });
    expect(matched.legacyByTxHash).toEqual({
      compared: 1,
      missingFromArchive: [],
    });
    expect(parityPassed(matched)).toBe(true);
  });

  it("fails an empty archive", () => {
    expect(parityPassed(diffEventIds({ archive: [], mirror: [] }))).toBe(false);
  });

  it("bounds the window by the start ledger and the lower of archive and published", () => {
    expect(
      parityRange({
        archiveLedger: 5000,
        publishedLedger: 4000,
        startLedger: 1234,
      }),
    ).toEqual({
      lower: 1234,
      upper: 4000,
    });
    expect(
      parityRange({
        archiveLedger: 5000,
        publishedLedger: 9000,
        startLedger: 1234,
      }),
    ).toEqual({
      lower: 1234,
      upper: 4280,
    });
  });

  it("refuses a missing goldsky state doc", () => {
    expect(() =>
      parityRange({
        archiveLedger: undefined,
        publishedLedger: 4000,
        startLedger: 1234,
      }),
    ).toThrow(/goldsky indexer_state/);
  });

  it("refuses a missing published ledger", () => {
    expect(() =>
      parityRange({
        archiveLedger: 5000,
        publishedLedger: undefined,
        startLedger: 1234,
      }),
    ).toThrow(/publishedLedger/);
  });

  it("refuses an unset or non-positive start ledger", () => {
    expect(() =>
      parityRange({
        archiveLedger: 5000,
        publishedLedger: 4000,
        startLedger: undefined,
      }),
    ).toThrow(/START_LEDGER/);
    expect(() =>
      parityRange({
        archiveLedger: 5000,
        publishedLedger: 4000,
        startLedger: NaN,
      }),
    ).toThrow(/START_LEDGER/);
    expect(() =>
      parityRange({
        archiveLedger: 5000,
        publishedLedger: 4000,
        startLedger: 0,
      }),
    ).toThrow(/START_LEDGER/);
  });

  it("refuses an empty window instead of comparing nothing", () => {
    expect(() =>
      parityRange({
        archiveLedger: 500,
        publishedLedger: 4000,
        startLedger: 1234,
      }),
    ).toThrow(/Empty parity range/);
    expect(() =>
      parityRange({
        archiveLedger: 5000,
        publishedLedger: 1000,
        startLedger: 1234,
      }),
    ).toThrow(/Empty parity range/);
  });
});
