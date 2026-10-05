import { getServerEnv } from "../../../../env.server";
import { syncPoolIndex } from "../../../../server/modules/deposits/deposits.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncPoolIndex();
  console.info("[pool-indexer]", JSON.stringify(result));
  return Response.json(result, {
    status: result.status === "degraded" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export const GET = handle;
export const POST = handle;
