"use client";
import { z } from "zod";
import { env } from "../../env";
import { createSessionInput, sessionStatusOutput } from "../../server/modules/cctp/cctp.schema";

export const recoveryRecordSchema = z.object({
  version: z.literal(1), input: createSessionInput, sessionId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceTxHash: z.string().max(128).optional(),
  solanaBlockhash: z.string().max(64).optional(), solanaLastValidBlockHeight: z.number().int().optional(),
  status: sessionStatusOutput.optional(),
});
export type RecoveryRecord = z.infer<typeof recoveryRecordSchema>;
const prefix = () => `olio:cctp-session:${env.NEXT_PUBLIC_STELLAR_NETWORK}:${env.NEXT_PUBLIC_OLIO_POOL_ID}:`;
export const recoveryKey = (record: RecoveryRecord) => `${prefix()}${record.input.feeQuote.quote.quoteId}`;
export function saveRecovery(record: RecoveryRecord) {
  const key = recoveryKey(record);
  const value = JSON.stringify(recoveryRecordSchema.parse(record));
  window.localStorage.setItem(key, value);
  if (window.localStorage.getItem(key) !== value) throw new Error("Payment recovery could not be saved. Enable browser storage before paying.");
}
export function removeRecovery(record: RecoveryRecord) {
  // Safe only for a record with no broadcast burn; the caller enforces that.
  try { window.localStorage.removeItem(recoveryKey(record)); } catch { /* storage unavailable */ }
}
export function loadRecoveries(username: string): RecoveryRecord[] {
  const results: RecoveryRecord[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(prefix())) continue;
    try {
      const record = recoveryRecordSchema.parse(JSON.parse(window.localStorage.getItem(key)!));
      if (record.input.username === username && record.status?.stage !== "completed") results.push(record);
    } catch { /* An unrelated malformed entry must not hide valid recovery records. */ }
  }
  return results;
}
export function newCapability() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}
export function exportRecovery(records: RecoveryRecord[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(records)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = "olio-payment-recovery.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
