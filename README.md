# WaDesk

A shared WhatsApp inbox and campaign tool for a team, built on the official WhatsApp Cloud API.

- **Team inbox**: every chat in one place, updating live, with assignment, open/closed status, search and delivery ticks.
- **Messages**: text, images and documents in both directions; approved templates when the 24-hour reply window is closed.
- **Contacts**: add, edit, tag, search, and import from CSV.
- **Campaigns**: send one approved template to a tag or to everyone, rate limited, with sent/delivered/read/failed reports.
- **Keyword auto-replies**, a **dashboard**, and **team roles** (owner, admin, agent).
- **Workspaces**: each business's data is separate, so the same install can serve several businesses.

## How it fits together

```
apps/web   Next.js 15 web app (browser)
apps/api   Express API + Socket.IO          src/server.js
           Queue worker (BullMQ)            src/worker.js
Postgres   all data                         apps/api/migrations
Redis      job queue + live-update channel
```

1. Meta posts a webhook to the API. The API checks the signature, queues it, and answers 200 at once.
2. The worker stores the message, downloads any media, runs auto-replies, and publishes an event.
3. Every API instance forwards that event over Socket.IO to the browsers of that workspace.
4. Campaigns fan out into one queued job per recipient, sent at a fixed rate with retries.

## Run it on a server

Docker Compose runs everything, with Caddy serving both sites over HTTPS. Step by step, from an empty server to a published Meta app: **[DEPLOY.md](DEPLOY.md)**.

Public policy pages Meta asks for are built in: `/privacy`, `/terms`, `/data-deletion`. Edit the company name and site in `apps/web/src/lib/legal.js`.

Run `npm install` once in `apps/api` and `apps/web` and commit the two `package-lock.json` files, so every build installs exactly the same package versions.

## Run it for development

Needs Node.js 20.11 or newer, Postgres 14+ and Redis 6+.

```bash
# API
cd apps/api
cp .env.example .env        # set DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY
npm install
npm run migrate
npm run dev                 # http://localhost:4000 (workers run in the same process)

# Web, in a second terminal
cd apps/web
cp .env.example .env.local
npm install
npm run dev                 # http://localhost:3000
```

Without SMTP settings, password-reset and invite links are printed in the API log.

Tests for the pure logic (phone numbers, template variables, encryption, webhook signatures):

```bash
cd apps/api && npm test
```

## Connect WhatsApp

You need a Meta Business app with the WhatsApp product and a phone number added to it. Menu names in Meta's dashboard change from time to time; the four values are what matter.

1. In **Settings → WhatsApp** in WaDesk, enter:
   - **Phone number ID** and **WhatsApp Business Account ID** (Meta app → WhatsApp → API Setup)
   - **Access token**: a permanent system-user token with `whatsapp_business_messaging` and `whatsapp_business_management`. The temporary token on the API Setup page expires within a day.
   - **App secret** (Meta app → App settings → Basic)
2. WaDesk checks the details with Meta, then shows a **Callback URL** and **Verify token**.
3. In the Meta app under WhatsApp → Configuration, paste both and subscribe to the **messages** field.
4. Send a WhatsApp message to your number. It should appear in the inbox within a second or two.
5. Go to **Templates → Sync from WhatsApp** to load your approved templates.

Meta only delivers webhooks to a public HTTPS address. On your own machine, run a tunnel (for example `ngrok http 4000`), set `API_PUBLIC_URL` to the tunnel address, and restart the API.

## Settings (environment variables)

| Variable | Needed | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. On Neon, use the direct (non-pooled) address so migrations can take their lock. |
| `REDIS_URL` | yes | Redis for the queue and live updates. Set `maxmemory-policy noeviction` on it. |
| `JWT_SECRET` | yes | Signs login tokens. 32+ characters. |
| `ENCRYPTION_KEY` | yes | 64 hex characters. Encrypts WhatsApp tokens at rest. Back it up. |
| `APP_URL` | yes | Address of the web app. Used for CORS and for links in emails. |
| `API_PUBLIC_URL` | yes | Public address of the API. Shown as the webhook URL. |
| `NEXT_PUBLIC_API_URL` | web | Same address, compiled into the web app at build time. |
| `TRUST_PROXY` | behind a proxy | `1` when one reverse proxy sits in front of the API, so rate limits see real IPs. |
| `COOKIE_SAMESITE` | sometimes | `lax` (default) or `none`. See "Domains" below. |
| `ALLOW_SIGNUP` | no | `false` stops new workspaces being created. |
| `EMBEDDED_WORKER` | no | `true` runs the queue workers inside the API process. |
| `META_GRAPH_VERSION` | no | Graph API version, default `v24.0`. |
| `CAMPAIGN_RATE_PER_SECOND` | no | Campaign send rate, default 20. Keep it under your number's WhatsApp throughput. |
| `MAX_UPLOAD_MB` | no | Largest file an agent can send, default 16. |
| `STORAGE_DIR` | no | Where media files are kept, default `./storage`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | no | Email for resets and invites. |

## Going live

- **HTTPS everywhere.** Put the web app and API behind a reverse proxy with TLS and set `TRUST_PROXY=1`.
- **Domains.** The login cookie works out of the box when both share a parent domain, such as `app.example.com` and `api.example.com`. On unrelated domains (for example a `vercel.app` web app with an `onrender.com` API) set `COOKIE_SAMESITE=none`; some browsers block such cookies, so a shared domain is the reliable choice.
- **Single-service hosts (Render, Railway).** Run the API with `EMBEDDED_WORKER=true` and start command `node src/migrate.js && node src/server.js`. Attach a persistent disk at `STORAGE_DIR`, or received media is lost on each deploy.
- **More than one API instance.** Supported: live updates go through Redis. Media needs shared storage; `apps/api/src/lib/storage.js` is the one file to swap for S3.
- **Backups.** Back up Postgres and the media volume. Keep `ENCRYPTION_KEY` somewhere safe.
- **Close signup** with `ALLOW_SIGNUP=false` once your workspace exists, unless you are offering it to other businesses.
- **Rate limits** are kept in memory per API instance. With several instances, move them to Redis or enforce limits at the proxy.

## Good to know

- **24-hour window.** WhatsApp allows free-form replies only within 24 hours of the customer's last message. After that the inbox offers templates only.
- **Opt-outs.** A customer who sends `STOP` or `UNSUBSCRIBE` is left out of campaigns; `START` puts them back. You can also set this per contact.
- **Hidden phone numbers.** WhatsApp usernames let customers hide their number. WaDesk then identifies them by the business-scoped user ID Meta sends, and replies still work.
- **Templates** are created and approved in WhatsApp Manager. WaDesk syncs and sends them. Templates with OTP, catalogue or flow buttons are listed but can't be sent from here yet.
- **Campaign variables** accept `{{name|there}}`, `{{phone}}` and `{{email}}`, filled in per contact; the text after `|` is used when the contact has no value.
- **CSV import** needs a `phone` column; `name`, `email` and `tags` (separated by `;`) are optional. Existing numbers are updated, not duplicated.
- **Roles.** Agents work the inbox and contacts. Admins also manage settings, team, campaigns and auto-replies. Only the owner manages admins.

## Security notes

- Passwords are hashed with bcrypt. Access tokens last 15 minutes and stay in browser memory; the refresh token is an httpOnly cookie, rotated on every use.
- WhatsApp access tokens and app secrets are encrypted with AES-256-GCM and never returned by the API.
- Every webhook is verified against Meta's `X-Hub-Signature-256` signature before it is processed.
- Every query is scoped to the signed-in user's workspace.
- Uploaded files are only ever served as downloads or as known safe media types, never as web pages.

## Project layout

```
apps/api/src
  app.js, server.js, worker.js   entry points
  routes/                        HTTP endpoints, one file per area
  services/                      WhatsApp client, inbound processing, sending, campaigns
  lib/, middleware/              crypto, validation, storage, auth, errors
apps/api/migrations              SQL schema
apps/web/src
  app/(auth)                     sign in, sign up, reset, invite
  app/(app)                      dashboard, inbox, contacts, templates, campaigns, auto-replies, team, settings
  components/, lib/              UI kit, API client, auth and socket providers
```
