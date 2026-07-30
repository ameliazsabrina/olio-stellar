import {
  sep10ClientSigningPublicKey,
  sep10NetworkPassphrase,
} from "../../../server/modules/anchor/anchor.service";

export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    const signingKey = sep10ClientSigningPublicKey();
    const networkPassphrase = sep10NetworkPassphrase();
    const body = [
      'VERSION="1.0.0"',
      `NETWORK_PASSPHRASE="${networkPassphrase}"`,
      `SIGNING_KEY="${signingKey}"`,
      `ACCOUNTS=["${signingKey}"]`,
      "",
    ].join("\n");
    return new Response(body, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch {
    return new Response("SEP-10 client signing is not configured.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
