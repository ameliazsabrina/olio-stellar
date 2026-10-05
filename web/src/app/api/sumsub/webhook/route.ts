import {
  handleWebhook,
  MAX_WEBHOOK_BYTES,
} from "../../../../server/modules/verification/sumsub.webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length")) > MAX_WEBHOOK_BYTES) {
    return respond({ received: true, ignored: "too_large" }, 413);
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(await request.arrayBuffer());
  } catch {
    return respond({ received: true, ignored: "unreadable" }, 400);
  }
  try {
    const result = await handleWebhook(raw, {
      algorithm: request.headers.get("x-payload-digest-alg"),
      digest: request.headers.get("x-payload-digest"),
    });
    if (result.outcome === "ignored") {
      const unauthenticated =
        result.reason === "unsigned" ||
        result.reason === "unsupported_algorithm" ||
        result.reason === "invalid_signature";
      if (unauthenticated) return respond({ received: false }, 401);
      if (result.reason === "disabled")
        return respond({ received: false }, 503);
      return respond({ received: true, ignored: result.reason });
    }
    return respond({ received: true, outcome: result.outcome });
  } catch {
    return respond({ received: false }, 503);
  }
}
