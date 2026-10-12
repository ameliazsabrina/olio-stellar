import "server-only";
import { getPaymentIntents } from "../../db/mongo";

export async function recordPayerSent(
  quoteId: string,
  at = new Date(),
): Promise<void> {
  try {
    await (await getPaymentIntents()).updateOne(
      { quoteId, "railRefs.payerSentAt": { $exists: false } },
      { $set: { "railRefs.payerSentAt": at } },
    );
  } catch (error) {
    console.warn(
      "[settlements] payer-sent marker was not recorded",
      error instanceof Error ? error.message : String(error),
    );
  }
}
