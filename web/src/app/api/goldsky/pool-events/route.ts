import {
  goldskyAuthorization,
  ingestGoldskyBatch,
  MAX_GOLDSKY_BATCH_BYTES,
} from "../../../../server/modules/goldsky/goldsky.webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const respond = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const logError = (error: unknown) =>
  console.error(
    "[goldsky]",
    error instanceof Error ? error.message : String(error),
  );

// Reads the body as a stream and gives up once it passes `limit`, so a
// chunked body without content-length cannot make the server buffer it all.
// Returns null when the body is too large.
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Buffer | null> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Goldsky retries 408/429/5xx forever and permanently fails the pipeline on
// any other 4xx, so only a wrong secret, an unparseable body or an oversized
// batch may stop delivery; everything transient is a 503.
export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  // The caller is authenticated before a single byte of the body is read.
  let auth: ReturnType<typeof goldskyAuthorization>;
  try {
    auth = goldskyAuthorization(authorization);
  } catch (error) {
    logError(error);
    return respond({ received: false }, 503);
  }
  if (auth === "disabled") return respond({ received: false }, 503);
  if (auth === "unauthorized") return respond({ received: false }, 401);

  if (Number(request.headers.get("content-length")) > MAX_GOLDSKY_BATCH_BYTES) {
    return respond({ received: false }, 413);
  }
  let raw: Buffer | null;
  try {
    raw = await readCapped(request.body, MAX_GOLDSKY_BATCH_BYTES);
  } catch {
    return respond({ received: false }, 503);
  }
  if (!raw) return respond({ received: false }, 413);

  try {
    const result = await ingestGoldskyBatch(raw, authorization);
    if (result.outcome === "unauthorized")
      return respond({ received: false }, 401);
    if (result.outcome === "malformed")
      return respond({ received: false }, 400);
    if (result.outcome === "disabled") return respond({ received: false }, 503);
    return respond({ received: true, ...result });
  } catch (error) {
    logError(error);
    return respond({ received: false }, 503);
  }
}
