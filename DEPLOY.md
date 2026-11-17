# Deploying WaDesk

One Linux server runs everything with Docker: Postgres, Redis, the API, the queue worker, the web app, and Caddy, which serves both sites over HTTPS with free Let's Encrypt certificates.

```
Internet ──443──▶ Caddy ─┬─▶ web:3000   (wadesk.yourdomain.com)
                         └─▶ api:4000   (api-wadesk.yourdomain.com, also Meta webhooks)
                                │
                         worker ┤  postgres  redis   (private, not reachable from outside)
```

## What you need

| Item | Notes |
|---|---|
| A server | Ubuntu 24.04, 2 vCPU, **4 GB RAM** (2 GB works with the swap step below), 40 GB disk. DigitalOcean, Hetzner, AWS Lightsail and similar all work. |
| Two subdomains | For example `wadesk.myleadkart.com` and `api-wadesk.myleadkart.com`. You need access to the domain's DNS settings. |
| The project folder | This repository. |

## 1. Create the server

Create an Ubuntu 24.04 server and note its **public IPv4 address**. Allow inbound ports **22, 80 and 443** in the provider's firewall.

## 2. Point the domains at it

In the domain's DNS settings add two **A records**, both pointing at the server IP:

| Type | Name | Value |
|---|---|---|
| A | `wadesk` | server IP |
| A | `api-wadesk` | server IP |

Check from your own computer (may take a few minutes):

```sh
dig +short wadesk.myleadkart.com
dig +short api-wadesk.myleadkart.com
```

Both should print the server IP. Caddy cannot get certificates until they do.

## 3. Install Docker on the server

```sh
ssh root@SERVER_IP
curl -fsSL https://get.docker.com | sh
docker compose version
```

On a 2 GB server, add swap so the web build doesn't run out of memory:

```sh
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Copy the project to the server

From your computer, in the folder that contains `wadesk`:

```sh
rsync -av --exclude node_modules --exclude .next --exclude .env wadesk/ root@SERVER_IP:/opt/wadesk/
```

(Or `git clone` your repository into `/opt/wadesk`.)

## 5. Create `.env` on the server

```sh
cd /opt/wadesk
cp .env.example .env
openssl rand -hex 16   # use for POSTGRES_PASSWORD
openssl rand -hex 32   # use for JWT_SECRET
openssl rand -hex 32   # use for ENCRYPTION_KEY
nano .env
```

Set at least:

```ini
POSTGRES_PASSWORD=<first value>
JWT_SECRET=<second value>
ENCRYPTION_KEY=<third value>
APP_DOMAIN=wadesk.myleadkart.com
API_DOMAIN=api-wadesk.myleadkart.com
ACME_EMAIL=<an email you read>
APP_URL=https://wadesk.myleadkart.com
API_PUBLIC_URL=https://api-wadesk.myleadkart.com
TRUST_PROXY=1
COOKIE_SAMESITE=lax
ALLOW_SIGNUP=true
```

Keep a copy of `ENCRYPTION_KEY` somewhere safe. Losing it means reconnecting WhatsApp.

## 6. Start it

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f caddy api
```

The first build takes a few minutes. When `caddy` logs `certificate obtained successfully` for both domains, open:

- `https://api-wadesk.myleadkart.com/health` → should answer OK
- `https://wadesk.myleadkart.com` → the sign-in page

## 7. Create the owner account and lock sign-up

1. Open the app, **Sign up**, and create the workspace (this account is the owner).
2. On the server set `ALLOW_SIGNUP=false` in `.env`, then `docker compose up -d api`.
3. Add teammates from **Team → Invite**.

Without SMTP settings, invite and password-reset links are written to the API log: `docker compose logs api | grep -i link`.

## 8. Connect WhatsApp and move Meta to the new address

1. In WaDesk **Settings**, enter the WhatsApp Business Account ID, phone number ID and the system-user access token, then save.
2. Copy the **Callback URL** and **Verify token** shown in Settings.
3. In the Meta app dashboard: **WhatsApp → Configuration → Webhook → Edit**, paste both, **Verify and save**. Check that the `messages` field is still subscribed.
4. Your laptop and ngrok are no longer needed.

## 9. Publish the Meta app

Real customers' messages and delivery receipts only reach apps that are **Live**.

1. Meta app dashboard → **App settings → Basic**:
   - Privacy policy URL: `https://wadesk.myleadkart.com/privacy`
   - Terms of service URL: `https://wadesk.myleadkart.com/terms`
   - User data deletion: instructions URL `https://wadesk.myleadkart.com/data-deletion`
   - App icon (1024×1024) and category
2. Save, then switch the app to **Live** (Publish).

## 10. Backups

```sh
cd /opt/wadesk && ./scripts/backup.sh
crontab -e
# add:  30 2 * * * cd /opt/wadesk && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Copy the `backups` folder off the server from time to time.

## Updating later

```sh
cd /opt/wadesk
# copy new code (rsync or git pull), then:
docker compose up -d --build
```

Migrations run automatically when the API starts.

## When something is wrong

| Symptom | Check |
|---|---|
| Browser shows a certificate error | DNS records (step 2), ports 80/443 open, `docker compose logs caddy` |
| Sign-in loops back to login | `APP_URL` and `API_PUBLIC_URL` use `https://` and match the real domains; rebuild web after changing `API_PUBLIC_URL` |
| Meta "verify and save" fails | `https://API_DOMAIN/health` loads; callback URL copied from WaDesk Settings exactly |
| Messages send but no ticks / no replies | Meta app is Live (step 9) and `messages` field subscribed |
| Campaigns stuck on "queued" | `docker compose logs worker` |
