import "server-only";
import { z } from "zod";
import { env } from "../../../env";
import { getServerEnv } from "../../../env.server";

export const sourceDomainSchema = z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5), z.literal(6)]);
export const routeManifestSchema = z.object({
  // A manifest is an operator assertion backed by the certification artifact.
  network: z.literal("testnet"),
  pool: z.string().regex(/^C[A-Z2-7]{55}$/),
  intake: z.string().regex(/^C[A-Z2-7]{55}$/),
  routing: z.literal("intake-v1"),
  evidence: z.string().min(1).max(256),
  routes: z.array(z.object({
    domain: sourceDomainSchema,
    eligible: z.boolean(),
    certified: z.boolean(),
  }).strict()).max(5),
}).strict().refine(v => new Set(v.routes.map(r => r.domain)).size === v.routes.length);

export function cctpConfig() {
  const config = getServerEnv();
  const manifest = config.CCTP_ROUTE_MANIFEST ? routeManifestSchema.parse(JSON.parse(config.CCTP_ROUTE_MANIFEST)) : null;
  if (manifest && (manifest.pool !== env.NEXT_PUBLIC_OLIO_POOL_ID || manifest.intake !== env.NEXT_PUBLIC_CCTP_INTAKE_CONTRACT)) {
    throw new Error("CCTP manifest does not match this deployment.");
  }
  return { ...config, manifest };
}

export function assertCctpTestnet() {
  if (env.NEXT_PUBLIC_STELLAR_NETWORK !== "testnet" || env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE !== "Test SDF Network ; September 2015") {
    throw new Error("This CCTP route is certified for testnet only.");
  }
}
