import { getServerEnv } from "../../../../env.server";
import { goldskyHealth } from "../../../../server/modules/goldsky/goldsky.health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const respond = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// The body always carries the archive's true status. The HTTP status is 503
// only when gap fill relies on the archive and it is not healthy, so a
// monitor can alert on it without paging during rollout (source off).
export async function GET(): Promise<Response> {
  try {
    const health = await goldskyHealth();
    const failing =
      health.gapFillSource === "goldsky" && health.status !== "healthy";
    return respond(health, failing ? 503 : 200);
  } catch (error) {
    console.error(
      "[goldsky] health check failed:",
      error instanceof Error ? error.message : String(error),
    );
    let gapFillSource: string | undefined;
    try {
      gapFillSource =
        getServerEnv().POOL_GAP_FILL_SOURCE === "goldsky" ? "goldsky" : "off";
    } catch {}
    // An unknown source fails closed.
    return respond(
      { status: "unavailable", ...(gapFillSource ? { gapFillSource } : {}) },
      gapFillSource === "off" ? 200 : 503,
    );
  }
}
