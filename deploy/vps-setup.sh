#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu/Debian VPS. Run as: sudo bash deploy/vps-setup.sh
set -euo pipefail   # stop on the first error instead of ploughing on half-configured

# 1. Docker Engine + Compose plugin (Docker's official install script).
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
# Let your normal user run docker without sudo (log out and back in to apply).
# Note: docker group membership is effectively root access. Fine on a personal VPS.
if [ -n "${SUDO_USER:-}" ]; then usermod -aG docker "$SUDO_USER"; fi

# 2. Firewall: SSH and web only. Allow SSH FIRST or you lock yourself out.
if command -v ufw >/dev/null; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

# 3. Swap. `pnpm install` + `tsc` during the image build can exceed 1GB RAM, and the
# kernel OOM-killer ends the build with a vague "Killed" / exit code 137.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

docker --version
docker compose version
echo "Done. Log out and back in so the docker group applies."
