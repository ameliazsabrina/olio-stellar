import { poolId, stellarNetwork } from "../../../lib/stellar";
import {
  EVIDENCE_SIGNING_DOMAIN,
  evidenceConfig,
} from "../../../server/modules/evidence/evidence.config";
import { toKeyOutput } from "../../../server/modules/evidence/evidence.router";
import { publishedEvidenceKeys } from "../../../server/modules/evidence/evidence.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const config = evidenceConfig();
    const keys = await publishedEvidenceKeys();
    return Response.json(
      {
        issuer: "olio",
        domain: EVIDENCE_SIGNING_DOMAIN,
        mode: config.mode,
        network: stellarNetwork,
        poolId,
        anchorAccount: config.anchorPublicKey,
        keys: keys.map(toKeyOutput),
      },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
