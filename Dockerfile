# syntax=docker/dockerfile:1

# ---- deps: install the full pnpm workspace ----
FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
# Copy only manifests first so this layer caches unless dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- builder: compile the Next.js standalone output ----
FROM node:22-bookworm-slim AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY . .

# NEXT_PUBLIC_* — inlined at build time. Keep in sync with web/.env.example.
ARG NEXT_PUBLIC_STELLAR_NETWORK
ARG NEXT_PUBLIC_STELLAR_RPC_URL
ARG NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE
ARG NEXT_PUBLIC_OLIO_REGISTRY_ID
ARG NEXT_PUBLIC_OLIO_POOL_ID
ARG NEXT_PUBLIC_USDC_SAC_ID
ARG NEXT_PUBLIC_USDC_ISSUER
ARG NEXT_PUBLIC_POOL_DEPTH
ARG NEXT_PUBLIC_SMART_WALLET_WASM_HASH
ARG NEXT_PUBLIC_CHANNELS_ENABLED
ARG NEXT_PUBLIC_SEP24_ANCHOR_URL
ARG NEXT_PUBLIC_SEP24_ASSET_CODE
ARG NEXT_PUBLIC_SEP10_CLIENT_DOMAIN
ARG NEXT_PUBLIC_STELLAR_HORIZON_URL
ARG NEXT_PUBLIC_FRIENDBOT_URL
ARG NEXT_PUBLIC_TRANSAK_API_KEY
ARG NEXT_PUBLIC_TRANSAK_ENV
ARG NEXT_PUBLIC_TRANSAK_FIAT_CURRENCY
ARG NEXT_PUBLIC_CCTP_INTAKE_CONTRACT
ARG NEXT_PUBLIC_CCTP_TOKEN_MESSENGER_MINTER
ARG NEXT_PUBLIC_CCTP_MESSAGE_TRANSMITTER
ARG NEXT_PUBLIC_CCTP_FORWARDER
ARG NEXT_PUBLIC_SOLANA_RPC_URL
ARG NEXT_PUBLIC_SOLANA_USDC_MINT

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# ---- runner: minimal runtime, no build tools or source ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Monorepo standalone layout: outputFileTracingRoot=repoRoot puts server.js under
# web/ inside the standalone bundle, with node_modules traced at the bundle root.
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

USER nextjs
EXPOSE 3000
# Treat any HTTP response (incl. middleware redirects) below 500 as healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
