#!/usr/bin/env bash
# One-time provisioning for a fresh Ubuntu VPS that runs the Olio prod stack.
# Run as root:  ssh root@<ip> 'bash -s' < scripts/vps-bootstrap.sh
#
# Afterwards the box is fully disposable: .github/workflows/deploy.yml syncs
# docker-compose.yml + Caddyfile and rewrites .env.production from the
# PROD_ENV_FILE GitHub secret on every deploy.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ufw unattended-upgrades fail2ban curl
# Some provider images (e.g. Hostinger) ship Docker CE already; installing
# Ubuntu's docker.io on top conflicts with it, so only install when missing.
if ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/olio"

# Key-only SSH.
cat >/etc/ssh/sshd_config.d/10-olio.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
systemctl reload ssh || systemctl reload sshd

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Bootstrap done. Public IP: $(curl -fsS https://api.ipify.org || hostname -I)"
docker --version
docker compose version
