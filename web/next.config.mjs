import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const rootEnv = path.join(repoRoot, ".env");
if (fs.existsSync(rootEnv)) {
  const lines = fs.readFileSync(rootEnv, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;

    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/dashboard/links",
        destination: "/links",
        permanent: true,
      },
      {
        source: "/dashboard/withdraw",
        destination: "/withdraw",
        permanent: true,
      },
      {
        source: "/dashboard/history",
        destination: "/history",
        permanent: true,
      },
    ];
  },
  // Emit a self-contained server bundle for the Docker runtime image. Combined
  // with outputFileTracingRoot (the monorepo root), the standalone output lands
  // at web/.next/standalone/web/server.js with node_modules traced from the
  // repo root — see the Dockerfile runner stage.
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  // These pull in native addons (sodium-native's signing fallback, mongodb's
  // optional drivers) that webpack can't statically bundle for the Node.js
  // server runtime — require them directly from node_modules at runtime
  // instead of trying to bundle them.
  serverExternalPackages: [
    "@stellar/stellar-sdk",
    "@stellar/stellar-base",
    "sodium-native",
    "mongodb",
    "@openzeppelin/relayer-plugin-channels",
  ],
  webpack: (config, { dev }) => {
    // The proof dependency graph (snarkjs/wasmcurves) makes Next's
    // persistent filesystem cache balloon to ~2GB. In dev, use an in-memory
    // cache instead so nothing accumulates on disk between restarts.
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },
};

export default nextConfig;
