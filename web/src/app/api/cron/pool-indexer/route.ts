import { syncPoolIndex } from "../../../../server/modules/deposits/deposits.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncPoolIndex();
  console.info("[pool-indexer]", JSON.stringify(result));
  return Response.json(result, {
    status: result.status === "degraded" ? 503 : 200,
  });
}
