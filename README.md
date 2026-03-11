# Mojang Authentication Status

A serverless status page for Mojang's authentication server, running entirely on Cloudflare Workers. Pings `sessionserver.mojang.com` every 5 minutes and displays uptime history, response times, and recent checks.

## How it works

- A cron trigger fires every 5 minutes and hits the Mojang endpoint
- A `204` response = operational. Anything else (or a timeout) = down
- Results are stored in Cloudflare KV (up to 7 days of history)
- The status page fetches `/api/status` on load and auto-refreshes every 30 seconds

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

**3. Run locally**

```bash
npm run dev
```

> Note: the cron trigger won't fire automatically in local dev. Visit `http://localhost:8787/api/trigger` to manually run a check.

**4. Deploy**

```bash
npm run deploy
```

## Endpoints

| Path | Description |
|------|-------------|
| `/` | Status page UI |
| `/api/status` | JSON — current status, uptime %, last 90 checks |
| `/api/trigger` | Manually trigger a health check (useful for testing) |
