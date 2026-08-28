# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY . .

ARG NEXT_PUBLIC_STELLAR_NETWORK
ARG NEXT_PUBLIC_STELLAR_RPC_URL
ARG NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE
ARG NEXT_PUBLIC_OLIO_REGISTRY_ID
ARG NEXT_PUBLIC_OLIO_POOL_ID
ARG NEXT_PUBLIC_USDC_SAC_ID
ARG NEXT_PUBLIC_USDC_ISSUER
ARG NEXT_PUBLIC_POOL_DEPTH
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_CHANNELS_ENABLED
ARG NEXT_PUBLIC_SEP24_ANCHOR_URL
ARG NEXT_PUBLIC_SEP24_ASSET_CODE
ARG NEXT_PUBLIC_SEP10_CLIENT_DOMAIN
ARG NEXT_PUBLIC_MONEYGRAM_RAMP_STATUS
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

FROM node:22-bookworm-slim AS migrate
WORKDIR /migrate
RUN printf '{"type":"module","dependencies":{"migrate-mongo":"14.0.7"}}\n' > package.json \
    && npm install --omit=dev --no-audit --no-fund
COPY web/migrate-mongo-config.cjs ./migrate-mongo-config.cjs
COPY web/migrations ./migrations

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public
COPY --from=migrate --chown=nextjs:nodejs /migrate /migrate

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
