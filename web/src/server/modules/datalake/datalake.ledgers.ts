import { createHash } from "node:crypto";
import { decompress } from "fzstd";
import { StrKey, xdr } from "stellar-sdk-ledgers/base";

export type DataLakeConfig = {
  networkPassphrase: string;
  compression: string;
  ledgersPerBatch: number;
  batchesPerPartition: number;
};

export type ArchivedPoolEvent = {
  id: string;
  ledger: number;
  txHash: string;
  ledgerClosedAt: Date;
  topics: string[];
  value: string;
};

export type LedgerScan = {
  ledger: number;
  hash: string;
  previousLedgerHash: string;
  events: ArchivedPoolEvent[];
};

export function rpcEventId(
  ledger: number,
  transactionIndex: number,
  operationIndex: number,
  eventIndex: number,
): string {
  const toid =
    (BigInt(ledger) << 32n) |
    (BigInt(transactionIndex + 1) << 12n) |
    BigInt(operationIndex);
  return `${toid.toString().padStart(19, "0")}-${String(eventIndex).padStart(10, "0")}`;
}

function reversedHex(ledger: number): string {
  return (0xffffffff - ledger).toString(16).toUpperCase().padStart(8, "0");
}

export function ledgerObjectKey(
  ledger: number,
  batchesPerPartition: number,
): string {
  const start = Math.floor(ledger / batchesPerPartition) * batchesPerPartition;
  const end = start + batchesPerPartition - 1;
  return `${reversedHex(start)}--${start}-${end}/${reversedHex(ledger)}--${ledger}.xdr.zst`;
}

const SUCCESS_CODES = new Set([
  xdr.TransactionResultCode.txSuccess().value,
  xdr.TransactionResultCode.txFeeBumpInnerSuccess().value,
]);

function operationEvents(meta: xdr.TransactionMeta): xdr.ContractEvent[][] {
  switch (meta.switch()) {
    case 4:
      return meta
        .v4()
        .operations()
        .map((operation) => operation.events());
    case 3:
      return [meta.v3().sorobanMeta()?.events() ?? []];
    default:
      return [];
  }
}

export function scanLedger(
  compressed: Uint8Array,
  ledger: number,
  contractId: string,
): LedgerScan {
  const batch = xdr.LedgerCloseMetaBatch.fromXDR(
    Buffer.from(decompress(compressed)),
  );
  const [meta, ...rest] = batch.ledgerCloseMeta();
  if (!meta || rest.length || batch.startSequence() !== ledger) {
    throw new Error(`file does not hold exactly ledger ${ledger}`);
  }
  const body =
    meta.switch() === 1 ? meta.v1() : meta.switch() === 2 ? meta.v2() : null;
  if (!body) throw new Error(`unsupported LedgerCloseMeta v${meta.switch()}`);

  const entry = body.ledgerHeader();
  const header = entry.header();
  if (header.ledgerSeq() !== ledger) {
    throw new Error(`header is ledger ${header.ledgerSeq()}, not ${ledger}`);
  }
  const hash = createHash("sha256").update(header.toXDR()).digest();
  if (!hash.equals(entry.hash())) throw new Error("header hash mismatch");
  const ledgerClosedAt = new Date(
    Number(header.scpValue().closeTime().toString()) * 1000,
  );

  const events: ArchivedPoolEvent[] = [];
  const txs: (xdr.TransactionResultMeta | xdr.TransactionResultMetaV1)[] =
    body.txProcessing();
  txs.forEach((tx, txIndex) => {
    const pair = tx.result();
    if (!SUCCESS_CODES.has(pair.result().result().switch().value)) return;
    const txHash = pair.transactionHash().toString("hex");
    operationEvents(tx.txApplyProcessing()).forEach((opEvents, opIndex) => {
      opEvents.forEach((event, eventIndex) => {
        if (event.type().name !== "contract") return;
        const id = event.contractId() as unknown as Buffer | null;
        if (!id || StrKey.encodeContract(id) !== contractId) return;
        const v0 = event.body().v0();
        events.push({
          id: rpcEventId(ledger, txIndex, opIndex, eventIndex),
          ledger,
          txHash,
          ledgerClosedAt,
          topics: v0.topics().map((topic) => topic.toXDR("base64")),
          value: v0.data().toXDR("base64"),
        });
      });
    });
  });

  return {
    ledger,
    hash: hash.toString("hex"),
    previousLedgerHash: header.previousLedgerHash().toString("hex"),
    events,
  };
}
