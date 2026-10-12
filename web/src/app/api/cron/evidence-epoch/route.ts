import { getServerEnv } from "../../../../env.server";
import { runEvidenceEpoch } from "../../../../server/modules/evidence/evidence.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: Request): Promise<Response> {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runEvidenceEpoch();
    console.info("[evidence-epoch]", JSON.stringify(result));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;
