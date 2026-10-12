import { getServerEnv } from "../../../../env.server";
import { SettlementStateError } from "../../../../server/modules/settlements/settlements.errors";
import {
  reconcileLeaf,
  reconcileSettlements,
} from "../../../../server/modules/settlements/settlements.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

async function handle(request: Request): Promise<Response> {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const leaf = new URL(request.url).searchParams.get("leaf");
  if (leaf !== null) {
    if (!/^\d{1,10}$/.test(leaf)) {
      return Response.json({ error: "Invalid leaf" }, { status: 400 });
    }
    try {
      const outcome = await reconcileLeaf(Number(leaf));
      return Response.json(
        { status: "reconciled", leafIndex: Number(leaf), ...outcome },
        { headers: noStore },
      );
    } catch (error) {
      if (error instanceof SettlementStateError) {
        return Response.json(
          { status: "rejected", reason: error.reason },
          { status: 409, headers: noStore },
        );
      }
      return Response.json(
        { status: "unavailable" },
        { status: 503, headers: noStore },
      );
    }
  }
  try {
    const result = await reconcileSettlements();
    console.info("[settlements-reconcile]", JSON.stringify(result));
    return Response.json(result, {
      status: result.status === "degraded" ? 503 : 200,
      headers: noStore,
    });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: noStore },
    );
  }
}

export const GET = handle;
export const POST = handle;
