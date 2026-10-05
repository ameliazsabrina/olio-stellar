import "server-only";
import { env } from "../../../env";
import { getDb, poolCollectionName } from "../../db/mongo";
import { assertCctpTestnet, cctpConfig, sourceDomainSchema } from "./cctp.config";
import { CctpOperationalError } from "./cctp.errors";
import { standardFee } from "./iris.client";
import { coordination } from "./cctp.storage";
import { checkSourceNetwork } from "./cctp.rpc";

export async function routeReadiness(sourceDomain: number) {
  const checkedAt = new Date().toISOString();
  const result = (state: "enabled" | "temporarily_unavailable" | "unsupported" | "eligibility_unavailable", reason: string, retryAfterMs = 30_000) => ({ state, reason, checkedAt, retryAfterMs, sourceDomain });
  if (!sourceDomainSchema.safeParse(sourceDomain).success) return result("unsupported", "unsupported_source");
  try {
    assertCctpTestnet();
    const config = cctpConfig();
    const route = config.manifest?.routes.find(r => r.domain === sourceDomain);
    if (!route?.eligible) return result("eligibility_unavailable", "eligibility_not_confirmed");
    if (!route.certified || !config.CCTP_SESSION_KEY || config.CCTP_WORKER_ENABLED !== "true") return result("temporarily_unavailable", "route_not_certified");
    const rows = await coordination();
    const circuit = await rows.findOne({ _id: `iris:circuit:${sourceDomain}` });
    if (circuit?.denied) return result("temporarily_unavailable", "upstream_denied_investigate");
    if (circuit?.nextAt && circuit.nextAt.getTime() > Date.now()) return result("temporarily_unavailable", circuit.denied ? "upstream_denied" : "upstream_backoff", circuit.nextAt.getTime() - Date.now());
    const heartbeat = await rows.findOne({ _id: `worker:${env.NEXT_PUBLIC_OLIO_POOL_ID}`, until: { $gt: new Date() } });
    if (!heartbeat) return result("temporarily_unavailable", "worker_unavailable");
    const indexes = await (await getDb()).collection(poolCollectionName("cctp_sessions")).listIndexes().toArray();
    if (!["session_quote", "session_due", "session_message"].every(name => indexes.some(i => i.name === name))) return result("temporarily_unavailable", "storage_not_ready");
    await checkSourceNetwork(sourceDomain);
    if (await standardFee(sourceDomain) !== 0) return result("unsupported", "provider_fee_requires_gross_up");
    return result("enabled", "ready", 15_000);
  } catch (error) {
    return result("temporarily_unavailable", error instanceof CctpOperationalError ? error.code : "dependency_unavailable");
  }
}

export async function assertRouteReady(sourceDomain: number) {
  const readiness = await routeReadiness(sourceDomain);
  if (readiness.state !== "enabled") throw new CctpOperationalError("unsupported", readiness.retryAfterMs);
}
