# Deploying llm-lab to a VPS

Assumes a fresh Ubuntu 22.04/24.04 VPS (1GB+ RAM) and SSH access. Commands marked **PowerShell** run on your Windows machine; **VPS** commands run over SSH.

## 1. Transfer the code

### Option A: Git (recommended)

You get history, easy updates (`git pull`), and nothing stray sneaks onto the server.

```powershell
# PowerShell, in D:\Vscode\Claude sessions\llm-lab
git init
git add .
git status            # CHECK: .env and node_modules must NOT be listed
git commit -m "llm-lab week 1 skeleton"
# Create an empty PRIVATE repo on GitHub, then:
git remote add origin https://github.com/<you>/llm-lab.git
git push -u origin main
```

```bash
# VPS
git clone https://github.com/<you>/llm-lab.git && cd llm-lab
```

Private repo on the VPS: use a fine-grained GitHub token (read-only, this repo only) as the password, or a deploy key.

### Option B: Copy a tarball (no GitHub)

```powershell
# PowerShell. Windows 10+ ships tar and scp
cd "D:\Vscode\Claude sessions"
tar --exclude=node_modules --exclude=.env --exclude=dist -czf llm-lab.tgz llm-lab
scp llm-lab.tgz <user>@<vps-ip>:~
```

```bash
# VPS
tar -xzf llm-lab.tgz && cd llm-lab
```

**Never copy `node_modules`.** It contains Windows binaries and the image builds its own anyway. **Never copy your local `.env`.** Create a fresh one on the server (step 3).

## 2. One-time server setup

```bash
# VPS
sudo bash deploy/vps-setup.sh   # Docker, firewall (22/80/443), 2GB swap
exit                            # log out and back in so `docker` works without sudo
```

## 3. Server `.env` (different from your laptop's)

```bash
# VPS, in llm-lab/
cp .env.example .env
openssl rand -hex 24            # copy the output: your DB password
nano .env
```

Set at least:

- `OPENAI_API_KEY`: ideally a **separate key with a monthly spend limit** set in the OpenAI dashboard, so a leak costs dollars, not hundreds.
- `DB_PASSWORD`: the random value. Set it **before** the first `up`, because Postgres only reads it when the volume is first created.
- `DOMAIN`: only if you're using HTTPS (step 5).

`DATABASE_URL` in `.env` is ignored by the containerised API (compose builds it with host `db`), so it doesn't matter here.

```bash
chmod 600 .env                  # only your user can read the secrets
```

## 4. Start it (no domain yet)

```bash
# VPS
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile full up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps   # api + db should be "healthy"
curl http://localhost:3002/api/health                                # {"ok":true,"db":"up"}
```

The API listens on the VPS's loopback only. To reach it from your laptop, use an SSH tunnel:

```powershell
# PowerShell. Keep this window open, then browse http://localhost:3002/api/health
ssh -N -L 3002:localhost:3002 <user>@<vps-ip>
```

**Creating tables:** Week 1 doesn't use them yet, so skip this for now. Postgres has no public port, so `db:push` must run _inside_ the Compose network, via a throwaway Node container:

```bash
# VPS, in llm-lab/. The network name is "<folder name>_default"
docker run --rm --network llm-lab_default --env-file .env -v "$PWD":/repo -w /repo node:22-alpine \
  sh -c 'corepack enable && pnpm install --frozen-lockfile --filter api... \
    && cd apps/api && DATABASE_URL="postgres://$DB_USER:$DB_PASSWORD@db:5432/$DB_NAME" pnpm db:push'
```

When we start persisting chats, we'll replace this with migrations that run automatically on deploy.

## 5. HTTPS with a domain (optional)

1. Point a DNS **A record** (e.g. `lab.yourdomain.com`) at the VPS IP. Wait until `ping lab.yourdomain.com` shows the right IP.
2. Set `DOMAIN=lab.yourdomain.com` in `.env`.
3. Start with the `https` profile:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile full --profile https up -d --build
curl https://lab.yourdomain.com/api/health
```

Caddy gets the certificate automatically. If it fails, `docker compose ... logs caddy` usually shows DNS not pointing at the server yet, or port 80 blocked by the VPS provider's own firewall panel (Hetzner, AWS security groups, etc. have one _outside_ ufw).

**Before task 2's `/api/chat` goes public, it needs auth or a rate limit.** We'll add that when we build the endpoint.

## 6. Day-2 operations

```bash
# Shorten the long command
alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile full'

dc logs -f api            # follow API logs
dc up -d --build          # deploy after `git pull`
dc restart api
dc down                   # stop (data kept)
dc down -v                # stop AND delete the database. Careful.

# Backup the DB
dc exec db pg_dump -U llmlab llmlab > backup-$(date +%F).sql
```

## Troubleshooting

| Symptom                                   | Cause                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Build dies with `Killed` / exit 137       | Out of memory. Run `vps-setup.sh` (adds swap) or use a 2GB VPS                                                    |
| `$'\r': command not found`                | Windows line endings. `.gitattributes` prevents this with Git; with a tarball, run `sed -i 's/\r$//' deploy/*.sh` |
| `password authentication failed`          | Changed `DB_PASSWORD` after first boot. `dc down -v` (wipes data) and `up` again                                  |
| `!reset` / `!override` error              | Compose older than v2.24. Install Docker via `vps-setup.sh` rather than `apt install docker-compose`              |
| Health OK on VPS, unreachable from laptop | Expected. Port is loopback-only. Use the SSH tunnel or HTTPS                                                      |

## Interview angle: what a "real" pipeline does differently

Building on the VPS is fine for learning, but it uses the server's CPU and RAM, and every server builds a slightly different image. Production setups build **once in CI** (GitHub Actions), push to a registry (GHCR, ECR), and servers only `docker pull`. That way the image you tested is byte-for-byte the image you run. Watch for architecture too: an ARM VPS (e.g. Hetzner CAX, AWS Graviton) can't run an amd64 image unless you build multi-arch with `docker buildx`.
