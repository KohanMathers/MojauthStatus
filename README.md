# Mojang Authentication Status

A self-hostable status page for Mojang's authentication server. Pings `sessionserver.mojang.com` every 5 minutes and displays uptime history, response times, and recent checks.

## How it works

- A scheduler in the server fires every 5 minutes (on the clock, e.g. :00, :05, :10) and hits the Mojang endpoint
- A `204` response = operational. Anything else (or a timeout) = down
- Results are stored in a SQLite database (up to ~7 days of checks)
- The status page fetches `/api/status` on load and auto-refreshes every 30 seconds
- When the service transitions from up to down, a Discord embed is sent to all subscribed webhooks

## Self-hosting with Docker Compose

```bash
git clone https://github.com/KohanMathers/MojauthStatus mojauth-status
cd mojauth-status
cp .env.example .env   # optional, only if you want to change the defaults
docker compose up -d
```

The page is now at `http://localhost:8787`. Data lives in the `mojauth-data` volume, so it survives restarts and rebuilds.

To update after pulling new changes:

```bash
docker compose up -d --build
```

Put it behind your reverse proxy of choice (Caddy, nginx, Traefik…) if you want it on a domain with HTTPS.

### Configuration

Set these in `.env` next to `compose.yaml`:

| Variable                 | Default | Description                                                    |
| ------------------------ | ------- | -------------------------------------------------------------- |
| `PORT`                   | `8787`  | Host port the page is published on                             |
| `CHECK_INTERVAL_MINUTES` | `5`     | How often to check the Mojang endpoint                         |
| `ENABLE_TRIGGER`         | `false` | Expose `/api/trigger` to run a check on demand (for testing)   |

## Running without Docker

Requires Node.js 22.13 or newer.

```bash
npm run dev
npm start
```

Data is written to `./data/mojauth.db` (override with `DATA_DIR`). `PORT` and `HOST` are also respected.

## Discord notifications

Visitors can subscribe to outage alerts via a Discord webhook. Click **Subscribe** in the header, paste a webhook URL, and hit subscribe. Submitting the same URL again removes it.

Notifications fire only on the transition from up -> down, not on every failed check, so a prolonged outage won't spam your channel.

The embed includes the time (UTC) and HTTP status code.

To create a webhook in Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.

## Endpoints

| Path             | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `/`              | Status page UI                                                 |
| `/api/status`    | JSON — current status, uptime %, last 90 checks                |
| `/api/trigger`   | Manually trigger a health check (only if `ENABLE_TRIGGER=true`) |
| `/api/subscribe` | `POST {url}` — add or remove a Discord webhook subscription    |
