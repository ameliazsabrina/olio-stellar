import "server-only";
import { env } from "../../../env";
import { getCctpSessions } from "../../db/mongo";
import { sourceDomainSchema } from "./cctp.config";
import { coordination } from "./cctp.storage";

export type CctpHealth = {
  status: "ok" | "degraded";
  checkedAt: string;
  worker: { alive: boolean; until: string | null };
  sessions: { active: number; needsAttention: number; oldestActiveAgeMs: number | null };
  circuits: { domain: number; failures: number; denied: boolean; openUntil: string | null }[];
};

export async function cctpHealth(now = new Date()): Promise<CctpHealth> {
  const rows = await coordination();
  const sessions = await getCctpSessions();
  const heartbeat = await rows.findOne({ _id: `worker:${env.NEXT_PUBLIC_OLIO_POOL_ID}` });
  const alive = Boolean(heartbeat?.until && heartbeat.until.getTime() > now.getTime());
  const activeFilter = { stage: { $nin: ["completed", "awaiting_signature", "needs_attention"] as const } };
  const [active, needsAttention, oldest] = await Promise.all([
    sessions.countDocuments(activeFilter),
    sessions.countDocuments({ stage: "needs_attention" }),
    sessions.find(activeFilter, { projection: { createdAt: 1 } }).sort({ createdAt: 1 }).limit(1).toArray(),
  ]);
  const circuits = (await rows.find({ _id: { $regex: /^iris:circuit:\d+$/ } }).toArray()).flatMap(row => {
    const domain = Number(row._id.slice("iris:circuit:".length));
    if (!sourceDomainSchema.safeParse(domain).success) return [];
    const openUntil = row.nextAt && row.nextAt.getTime() > now.getTime() ? row.nextAt.toISOString() : null;
    return [{ domain, failures: row.failures ?? 0, denied: Boolean(row.denied), openUntil }];
  });
  return {
    status: alive && needsAttention === 0 && !circuits.some(c => c.denied) ? "ok" : "degraded",
    checkedAt: now.toISOString(),
    worker: { alive, until: heartbeat?.until?.toISOString() ?? null },
    sessions: { active, needsAttention, oldestActiveAgeMs: oldest[0] ? now.getTime() - oldest[0].createdAt.getTime() : null },
    circuits,
  };
}
