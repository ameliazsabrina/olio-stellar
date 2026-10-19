import "server-only";
import { getServerEnv } from "../../../env.server";
import { server } from "../../../lib/stellar";
import { getIndexerState } from "../../db/mongo";
import { GOLDSKY_HEARTBEAT_MARGIN } from "./goldsky.events";

export type GapFillSource = "off" | "goldsky";

export type GoldskyHealth =
  | { status: "disabled"; gapFillSource: GapFillSource }
  | {
      status: "healthy" | "lagging" | "degraded";
      gapFillSource: GapFillSource;
      lastLedger: number;
      tipLedger: number;
      lagLedgers: number;
      heartbeatAt: string | null;
      rejectedRows: number;
      correctionAt: string | null;
    };

// The archive is monitored whenever the webhook can receive (the secret is
// set), including the rollout phase where gap fill is still off; only the
// HTTP status of the route depends on whether gap fill relies on it.
export async function goldskyHealth(): Promise<GoldskyHealth> {
  const env = getServerEnv();
  const gapFillSource: GapFillSource =
    env.POOL_GAP_FILL_SOURCE === "goldsky" ? "goldsky" : "off";
  if (!env.GOLDSKY_WEBHOOK_SECRET) return { status: "disabled", gapFillSource };
  const [state, tip] = await Promise.all([
    (await getIndexerState()).findOne({ _id: "goldsky" }),
    server.getLatestLedger(),
  ]);
  const lastLedger = state?.lastLedger ?? 0;
  const lagLedgers = Math.max(0, tip.sequence - lastLedger);
  const rejectedRows = state?.rejectedRows ?? 0;
  // A lagging archive cannot vouch for a gap; rejected rows or a correction
  // mean its contents need a human look before it is trusted.
  const status =
    rejectedRows > 0 || state?.correctionAt
      ? "degraded"
      : lagLedgers > GOLDSKY_HEARTBEAT_MARGIN
        ? "lagging"
        : "healthy";
  return {
    status,
    gapFillSource,
    lastLedger,
    tipLedger: tip.sequence,
    lagLedgers,
    heartbeatAt: state?.heartbeatAt?.toISOString() ?? null,
    rejectedRows,
    correctionAt: state?.correctionAt?.toISOString() ?? null,
  };
}
