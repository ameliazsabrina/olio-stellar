import { boundedJson } from "../../../../../server/modules/cctp/iris.client";
import { sourceRpc, validateRpcRequest } from "../../../../../server/modules/cctp/cctp.rpc";
import { sharedBudget } from "../../../../../server/modules/cctp/cctp.storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ domain: string }> }) {
  try {
    await sharedBudget("rpc-ingress", 120, 60_000);
    const domain = Number((await context.params).domain);
    const input = validateRpcRequest(domain, await boundedJson(new Response(request.body), 8192));
    const result = await sourceRpc(domain, input.method, input.params);
    return Response.json({ jsonrpc: "2.0", id: input.id, result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Source network request unavailable or unsupported." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
