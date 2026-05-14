const MOJANG_URL =
  'https://sessionserver.mojang.com/session/minecraft/hasJoined?username=Steve&serverId=gibberish123';
const MAX_CHECKS = 2016;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return handlePage(env);
    }

    if (url.pathname === '/api/status') {
      return handleApiStatus(env);
    }

    if (url.pathname === '/api/trigger') {
      await performCheck(env);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/subscribe') {
      return handleSubscribe(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(performCheck(env));
  },
};

async function performCheck(env) {
  const start = Date.now();
  let status = 'down';
  let statusCode = 0;
  let responseTime = 0;

  try {
    const response = await fetch(MOJANG_URL, {
      signal: AbortSignal.timeout(10000),
    });
    statusCode = response.status;
    responseTime = Date.now() - start;
    status = statusCode === 204 ? 'up' : 'down';
  } catch {
    responseTime = Date.now() - start;
    status = 'down';
    statusCode = 0;
  }

  const existing = await readChecks(env);
  const lastCheck = existing.length > 0 ? existing[existing.length - 1] : null;

  const check = { t: Date.now(), s: status, c: statusCode, r: responseTime };
  await appendCheck(env, check);

  if (status === 'down' && (!lastCheck || lastCheck.s === 'up')) {
    await notifyWebhooks(env, check);
  }
}

function computeStatusData(checks) {
  const now = Date.now();
  const ms = (h) => h * 3600000;
  const filter = (since) => checks.filter((c) => c.t >= now - since);

  const uptime = (arr) => {
    if (!arr.length) return null;
    return +(arr.filter((c) => c.s === 'up').length / arr.length * 100).toFixed(2);
  };

  const avgResponseTime = (arr) => {
    const ups = arr.filter((c) => c.s === 'up');
    if (!ups.length) return null;
    return Math.round(ups.reduce((a, c) => a + c.r, 0) / ups.length);
  };

  const last24h = filter(ms(24));
  const last7d = filter(ms(24 * 7));
  const last30d = filter(ms(24 * 30));

  return {
    current: checks[checks.length - 1] || null,
    uptime24h: uptime(last24h),
    uptime7d: uptime(last7d),
    uptime30d: uptime(last30d),
    avgResponseTime24h: avgResponseTime(last24h),
    recent: checks.slice(-90),
    total: checks.length,
  };
}

async function handleApiStatus(env) {
  const checks = await readChecks(env);
  return new Response(JSON.stringify(computeStatusData(checks)), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function utcTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function utcDate(ts) {
  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function ssrFmtUptime(v) {
  if (v === null) return '—';
  const cls = v >= 99 ? 'up' : v >= 95 ? '' : 'down';
  return `<span class="val ${cls}">${v}%</span>`;
}

function ssrTimeline(recent) {
  const bars = recent.map((c, i) =>
    `<div class="t-bar ${c.s === 'up' ? 'up' : c.s === 'down' ? 'down' : ''}" data-i="${i}"></div>`
  ).join('');
  const oldest = recent.length ? utcTime(recent[0].t) : '';
  const newest = recent.length ? `${utcTime(recent[recent.length - 1].t)} UTC` : '';
  return `
    <div class="timeline-bars" id="t-bars">${bars}</div>
    <div class="timeline-labels"><span>${oldest}</span><span>${newest}</span></div>`;
}

function ssrRtChart(recent) {
  const pts = recent.filter((c) => c.s === 'up');
  if (pts.length < 2) {
    return '<p style="color:var(--muted);font-size:0.8rem;text-align:center;padding:20px">Not enough data yet</p>';
  }
  const W = 680, H = 110, PAD = { t: 8, b: 24, l: 36, r: 8 };
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
  const vals = pts.map((c) => c.r);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const px = (i) => PAD.l + (i / (pts.length - 1)) * cW;
  const py = (v) => PAD.t + cH - ((v - minV) / range) * cH;
  const coords = pts.map((c, i) => [px(i), py(c.r)]);
  const linePath = 'M ' + coords.map(([x, y]) => `${x},${y}`).join(' L ');
  const areaPath = `${linePath} L ${coords[coords.length - 1][0]},${PAD.t + cH} L ${PAD.l},${PAD.t + cH} Z`;
  const avgMs = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  const yLabels = [minV, Math.round((minV + maxV) / 2), maxV].map((v) =>
    `<text x="${PAD.l - 4}" y="${py(v) + 4}" text-anchor="end" fill="#6b7280" font-size="9">${v}ms</text>`
  ).join('');
  const visibleDots = coords.map(([x, y], i) => {
    if (i !== 0 && i !== coords.length - 1) return '';
    return `<circle cx="${x}" cy="${y}" r="3" fill="#6366f1" stroke="rgba(99,102,241,0.3)" stroke-width="5"/>`;
  }).join('');
  return `
    <svg id="rt-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="rtg_ssr" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t + cH}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      <line x1="${PAD.l}" y1="${PAD.t + cH}" x2="${PAD.l + cW}" y2="${PAD.t + cH}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
      ${[0.25, 0.5, 0.75].map((f) =>
    `<line x1="${PAD.l}" y1="${PAD.t + cH * (1 - f)}" x2="${PAD.l + cW}" y2="${PAD.t + cH * (1 - f)}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>`
  ).join('')}
      ${yLabels}
      <path d="${areaPath}" fill="url(#rtg_ssr)"/>
      <path d="${linePath}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${visibleDots}
      <text x="${PAD.l + cW}" y="${H - 4}" text-anchor="end" fill="#6b7280" font-size="9">avg ${avgMs}ms</text>
    </svg>`;
}

function ssrChecks(recent) {
  return recent.slice().reverse().slice(0, 8).map((c) => {
    const cls = c.s === 'up' ? 'up' : 'down';
    const label = c.s === 'up' ? 'Up' : 'Down';
    return `
      <div class="check-row">
        <span class="check-time">${utcDate(c.t)}</span>
        <span class="check-code">${c.c || '—'}</span>
        <span class="check-badge ${cls}">${label}</span>
      </div>`;
  }).join('');
}

function ssrContent(data) {
  const cur = data.current;
  const isUp = cur && cur.s === 'up';
  const heroClass = !cur ? '' : isUp ? 'is-up' : 'is-down';
  const mainLabel = !cur ? 'Awaiting first check…' : isUp ? 'Up and running' : 'Not responding';
  const subLabel = !cur
    ? 'No data yet.'
    : `HTTP ${cur.c || '—'} &mdash; ${cur.r}ms response &mdash; checked ${utcTime(cur.t)} UTC`;
  return `
    <div class="status-hero ${heroClass}">
      <div class="pulse-ring ${!cur || isUp ? '' : 'down'}">
        <div class="pulse-dot ${!cur || isUp ? '' : 'down'}"></div>
      </div>
      <div class="status-label">
        <div class="main">${mainLabel}</div>
        <div class="sub">${subLabel}</div>
      </div>
      </div>
    <div class="stats-row">
      <div class="stat-box">${ssrFmtUptime(data.uptime24h)}<div class="label">24h uptime</div></div>
      <div class="stat-box">${ssrFmtUptime(data.uptime7d)}<div class="label">7d uptime</div></div>
      <div class="stat-box">${ssrFmtUptime(data.uptime30d)}<div class="label">30d uptime</div></div>
    </div>
    <div class="timeline-wrap">
      <div class="section-title">Last 90 checks<span>Each bar = 5 minutes</span></div>
      ${ssrTimeline(data.recent)}
    </div>
    <div class="dashboard-bottom">
      <div class="chart-wrap">
        <div class="section-title">Response time<span>Successful checks only</span></div>
        <div id="rt-chart-container">${ssrRtChart(data.recent)}</div>
      </div>
      <div class="checks-wrap">
        <div class="section-title" style="padding: 12px 16px 0; margin-bottom: 0;">Recent checks</div>
        ${ssrChecks(data.recent)}
      </div>
    </div>`;
}

async function handlePage(env) {
  const checks = await readChecks(env);
  const data = computeStatusData(checks);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mojang Auth Status</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="tooltip"></div>
  <header class="page-header">
    <div class="page-header-inner">
      <div class="brand">
        <img height="28" width="28" src="https://upload.wikimedia.org/wikipedia/commons/6/64/Minecraft-creeper-face.svg" alt="Creeper Icon">
        <div>
          <span class="brand-title">Mojang Auth Status</span>
          <span class="brand-sub">sessionserver.mojang.com &mdash; checked every 5 minutes</span>
        </div>
      </div>
      <div class="header-controls js-only">
        <button id="clock-toggle" class="clock-toggle"></button>
        <button id="readme-button" class="readme-button" aria-haspopup="dialog" aria-controls="readme-modal">please read me :)</button>
        <button id="subscribe-button" class="clock-toggle" aria-haspopup="dialog" aria-controls="subscribe-modal">Subscribe</button>
        <div class="refresh-timer">
          <div class="refresh-dot"></div>
          <span id="refresh-countdown">Refresh in 30s</span>
        </div>
      </div>
    </div>
  </header>
  <main class="page-main">
    <div id="content">
      <div class="loading">
        <div class="spinner"></div>
        <span>Fetching status&hellip;</span>
      </div>
    </div>
    <noscript>
      <style>#content { display: none; } #last-updated { display: none; }</style>
      ${ssrContent(data)}
    </noscript>
    <footer class="page-footer">
      <span id="last-updated">Loading&hellip;</span>
    </footer>
  </main>
  <div id="readme-modal" class="modal" aria-hidden="true">
    <div class="modal-backdrop" data-close="readme"></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="readme-title">
      <button class="modal-close" data-close="readme" aria-label="Close">&times;</button>
      <h2 id="readme-title">A quick note</h2>
      <p>I build these tools for fun and for the community. Keeping everything running does have real maintenance costs, and even $1 goes a long way.</p>
      <p>If you enjoy the tools and want to give back, you can support me here: <a href="https://buymeacoffee.com/kohanmathers" target="_blank" rel="noopener noreferrer">Buy me a coffee</a>. No pressure either way &mdash; thanks for being here.</p>
    </div>
  </div>
  <div id="subscribe-modal" class="modal" aria-hidden="true">
    <div class="modal-backdrop" data-close="subscribe"></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="subscribe-title">
      <button class="modal-close" data-close="subscribe" aria-label="Close">&times;</button>
      <h2 id="subscribe-title">Discord notifications</h2>
      <p>Enter a Discord webhook URL to get a message when the auth server goes down. Enter the same URL again to unsubscribe.</p>
      <div class="subscribe-form">
        <input id="webhook-input" type="url" class="webhook-input" placeholder="https://discord.com/api/webhooks/..." autocomplete="off" spellcheck="false">
        <button id="webhook-submit" class="webhook-submit">Subscribe</button>
      </div>
      <p id="webhook-result" class="webhook-result" aria-live="polite"></p>
    </div>
  </div>
  <script src="/app.js"></script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

function getStatusStore(env) {
  const id = env.STATUS_DO.idFromName('global');
  return env.STATUS_DO.get(id);
}

async function readChecks(env) {
  const stub = getStatusStore(env);
  const res = await stub.fetch('https://status/checks');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.checks) ? data.checks : [];
}

async function appendCheck(env, check) {
  const stub = getStatusStore(env);
  await stub.fetch('https://status/checks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(check),
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isDiscordWebhook(url) {
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'discord.com' ||
        u.hostname === 'discordapp.com' ||
        u.hostname.endsWith('.discord.com')) &&
      u.pathname.startsWith('/api/webhooks/')
    );
  } catch {
    return false;
  }
}

async function handleSubscribe(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return jsonResponse({ error: 'Missing url' }, 400);
  }
  if (!isDiscordWebhook(url)) {
    return jsonResponse({ error: 'Not a valid Discord webhook URL' }, 400);
  }

  const existing = await env.DB.prepare('SELECT url FROM webhooks WHERE url = ?').bind(url).first();
  if (existing) {
    await env.DB.prepare('DELETE FROM webhooks WHERE url = ?').bind(url).run();
    return jsonResponse({ subscribed: false });
  }

  await env.DB.prepare('INSERT INTO webhooks (url, created_at) VALUES (?, ?)').bind(url, Date.now()).run();
  return jsonResponse({ subscribed: true });
}

async function notifyWebhooks(env, check) {
  let rows;
  try {
    const result = await env.DB.prepare('SELECT url FROM webhooks').all();
    rows = result.results;
  } catch {
    return;
  }
  if (!rows.length) return;

  const statusStr = check.c ? `HTTP ${check.c}` : 'Timeout';
  const payload = {
    username: 'Mojang Status',
    embeds: [
      {
        title: '⚠️ Mojang Auth is down',
        description:
          'sessionserver.mojang.com stopped responding to authentication checks.',
        color: 0xed4245,
        fields: [
          { name: 'Time', value: `${utcTime(check.t)} UTC`, inline: true },
          { name: 'Status', value: statusStr, inline: true },
        ],
        timestamp: new Date(check.t).toISOString(),
        footer: { text: 'mojauth status monitor' },
      },
    ],
  };

  await Promise.allSettled(
    rows.map(({ url }) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })
    )
  );
}

export class StatusStore {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== '/checks') {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'GET') {
      const checks = (await this.state.storage.get('checks')) || [];
      return new Response(JSON.stringify({ checks }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'POST') {
      const check = await request.json();
      const existing = (await this.state.storage.get('checks')) || [];
      existing.push(check);
      if (existing.length > MAX_CHECKS) {
        existing.splice(0, existing.length - MAX_CHECKS);
      }
      await this.state.storage.put('checks', existing);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method not allowed', { status: 405 });
  }
}
