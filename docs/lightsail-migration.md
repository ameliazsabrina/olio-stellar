# Migrating Olio web from Vercel to AWS Lightsail

Runbook for moving the `web/` Next.js app off Vercel onto a Lightsail Docker
instance. Motivation: Vercel Cron cannot run `/api/cron/pool-indexer` every
minute on our plan; a plain VPS host crontab can, for free.

## Architecture

```
Internet ──443/80──▶ Lightsail static IP ──▶ Caddy (auto-TLS) ──▶ web:3000 (Next standalone)
                                                                     │
host crontab ── curl localhost:3000/api/cron/pool-indexer (Bearer CRON_SECRET)
                                                                     │
                                                          MONGODB_URI ─▶ MongoDB Atlas
```

- Image is built in **GitHub Actions** and pushed to **GHCR**; the box only pulls.
- Mongo stays on **Atlas** (managed). No stateful container on the box.

## One-time setup

### 1. Lightsail instance
- Create an instance: Linux/Unix, **Ubuntu 22.04 LTS**, plan **2 GB / 2 vCPU ($12/mo)**.
- Networking tab → create a **static IP** and attach it.
- Firewall → allow **HTTP (80)** and **HTTPS (443)** in addition to SSH (22).
- SSH in and install Docker:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER    # re-login after this
  ```

### 2. App directory on the box
```bash
mkdir -p ~/olio && cd ~/olio
# copy these three files from the repo into ~/olio:
#   docker-compose.yml   Caddyfile   .env.production.example
cp .env.production.example .env.production && chmod 600 .env.production
# fill in .env.production with real MONGODB_URI / CRON_SECRET / API keys
printf 'DOMAIN=yourdomain.com\nOLIO_IMAGE=ghcr.io/OWNER/olio-web:latest\n' > .env
```

### 3. GitHub repo config
- **Variables** (public, Settings → Secrets and variables → Actions → Variables):
  every `NEXT_PUBLIC_*` from `web/.env.example`.
- **Secrets**: `SSH_HOST` (static IP), `SSH_USER` (e.g. `ubuntu`), `SSH_KEY`
  (a private key whose public half is in the box's `~/.ssh/authorized_keys`).
- GHCR auth uses the built-in `GITHUB_TOKEN` — no PAT needed.

### 4. MongoDB Atlas
- Atlas → Network Access → add the Lightsail **static IP** to the allowlist
  (and remove/keep the old Vercel egress entry until cutover is done).
- Keep `MONGODB_URI` unchanged; `getDb()` resolves the db name from the URI.

### 5. Apply DB migrations (once, before first cron run)
From a machine with the prod `MONGODB_URI`:
```bash
cd web && pnpm migrate:up
```

## Deploy

Push to `main` (or run the **Deploy web to Lightsail** workflow manually). CI
builds, pushes to GHCR, then SSHes to the box and runs `docker compose pull &&
up -d`. First deploy on the box can also be done by hand:
```bash
cd ~/olio && docker compose pull && docker compose up -d
docker compose logs -f caddy   # watch the cert get issued
```

## Cron (replaces Vercel Cron)

Add a host crontab entry (`crontab -e`) — every minute, unlimited on a VPS:
```cron
* * * * * curl -fsS -m 55 -H "Authorization: Bearer $(grep '^CRON_SECRET=' /home/ubuntu/olio/.env.production | cut -d= -f2)" http://localhost:3000/api/cron/pool-indexer >> /var/log/olio-cron.log 2>&1
```
Port 3000 is reachable from the host because compose maps it only on the internal
network — if you prefer, curl through Caddy at `https://yourdomain.com/...`
instead. The indexer uses a `leaseOwner`/`leaseUntil` lease in `indexer_state`,
so an overlapping run is a safe no-op.

## Domain + TLS

1. Point DNS at the static IP (registrar or a Lightsail DNS zone):
   `A  @  <static IP>` (and `A www <static IP>` if used).
2. Set `DOMAIN=yourdomain.com` in `~/olio/.env`.
3. `docker compose up -d caddy` — Caddy fetches a Let's Encrypt cert on first hit.

Use a **low TTL (300s)** during cutover. Validate on the static IP / a temp
subdomain before flipping the apex.

## Cutover checklist

- [ ] Box up, `docker compose ps` healthy, `https://<temp>` serves the app.
- [ ] Atlas allowlist includes the static IP; migrations applied.
- [ ] Cron entry firing (`tail -f /var/log/olio-cron.log` shows 200s).
- [ ] DNS flipped to the static IP.
- [ ] Vercel Cron **disabled** (avoid double-indexing) but project left deployed.
- [ ] After ~48h stable, remove the Vercel project and the old Atlas allowlist entry.

## Rollback

DNS still points at Vercel's edge until you flip it, so rollback = repoint DNS
back and re-enable Vercel Cron. Keep the Vercel project deployed for 48h.

## Gotchas

- **NEXT_PUBLIC_* are build-time.** They must be GitHub **Variables** feeding
  `--build-arg`, not runtime env. Blank build args = blank values in the browser.
- **Standalone monorepo paths.** Output nests under `web/.next/standalone/web/`,
  hence the Dockerfile `COPY` paths and `CMD ["node","web/server.js"]`.
- **Native addons need glibc.** The image is `node:22-bookworm-slim`, not alpine,
  for `sodium-native` / `mongodb` / snarkjs wasm.
- **Build memory.** Build runs in CI, not on the $12 box; don't `docker build`
  on the instance or it may OOM.
