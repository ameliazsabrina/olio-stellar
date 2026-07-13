export type Context = { ip: string | null };

export function createTRPCContext(opts?: { req: Request }): Context {
  return { ip: opts ? clientIp(opts.req) : null };
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}
