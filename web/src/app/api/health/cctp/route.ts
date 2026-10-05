import { cctpHealth } from "../../../../server/modules/cctp/cctp.health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const health = await cctpHealth();
    return Response.json(health, { status: health.status === "degraded" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
