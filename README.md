# Mojang Authentication Status

A serverless status page for Mojang's authentication server, running entirely on Cloudflare Workers. Pings `sessionserver.mojang.com` every 5 minutes and displays uptime history, response times, and recent checks.

## How it works

- A cron trigger fires every 5 minutes and hits the Mojang endpoint
- A `204` response = operational. Anything else (or a timeout) = down
- Results are stored in a Cloudflare Durable Object (up to ~7 days of checks)
- The status page fetches `/api/status` on load and auto-refreshes every 30 seconds
- When the service transitions from up to down, a Discord embed is sent to all subscribed webhooks

## Setup

**1. Install dependencies**

```bash
npm install
```

**2. Create the KV namespace**

```bash
npm run kv:create
```

Copy the `id` from the output and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "STATUS_KV"
id = "paste-your-id-here"
```

**3. Create the D1 database**

```bash
wrangler d1 create mojauth-webhooks
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "mojauth-webhooks"
database_id = "paste-your-id-here"
```

Then run the migration to create the webhooks table:

```bash
wrangler d1 execute mojauth-webhooks --file=migrations/0001_webhooks.sql
```

**4. Run locally**

```bash
npm run dev
```

> Note: the cron trigger won't fire automatically in local dev. Visit `http://localhost:8787/api/trigger` to manually run a check.

**5. Deploy**

```bash
npm run deploy
```

## Discord notifications

Visitors can subscribe to outage alerts via a Discord webhook. Click **Subscribe** in the header, paste a webhook URL, and hit subscribe. Submitting the same URL again removes it.

Notifications fire only on the transition from up -> down, not on every failed check, so a prolonged outage won't spam your channel.

The embed includes the time (UTC), HTTP status code, and a link back to the status page.

To create a webhook in Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.

## Endpoints

| Path             | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `/`              | Status page UI                                              |
| `/api/status`    | JSON — current status, uptime %, last 90 checks             |
| `/api/trigger`   | Manually trigger a health check (useful for testing)        |
| `/api/subscribe` | `POST {url}` — add or remove a Discord webhook subscription |
