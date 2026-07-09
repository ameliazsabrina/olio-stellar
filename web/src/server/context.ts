export type Context = {
  token: string | null;
};

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function createTRPCContext(req: Request): Context {
  return { token: bearer(req) };
}
