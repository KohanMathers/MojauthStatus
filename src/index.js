const MOJANG_URL =
  'https://sessionserver.mojang.com/session/minecraft/hasJoined?username=Steve&serverId=gibberish123';
const MAX_CHECKS = 2016;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status') {
      return handleApiStatus(env);
    }

    if (url.pathname === '/api/trigger') {
      await performCheck(env);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(getHTML(), {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-cache',
      },
    });
  },

  async scheduled(event, env, ctx) {
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

  const check = { t: Date.now(), s: status, c: statusCode, r: responseTime };

  const existing = (await env.STATUS_KV.get('checks', 'json')) || [];
  existing.push(check);
  if (existing.length > MAX_CHECKS) {
    existing.splice(0, existing.length - MAX_CHECKS);
  }

  await env.STATUS_KV.put('checks', JSON.stringify(existing));
}

async function handleApiStatus(env) {
  const checks = (await env.STATUS_KV.get('checks', 'json')) || [];

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

  return new Response(
    JSON.stringify({
      current: checks[checks.length - 1] || null,
      uptime24h: uptime(last24h),
      uptime7d: uptime(last7d),
      uptime30d: uptime(last30d),
      avgResponseTime24h: avgResponseTime(last24h),
      recent: checks.slice(-90),
      total: checks.length,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mojang Auth Status</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --up: #4ade80;
    --up-dim: rgba(74, 222, 128, 0.15);
    --down: #f87171;
    --down-dim: rgba(248, 113, 113, 0.15);
    --card-bg: rgba(7, 7, 14, 0.87);
    --border: rgba(255,255,255,0.07);
    --text: #e8e8f0;
    --muted: #8888a0;
    --surface: rgba(255,255,255,0.04);
    --surface-hover: rgba(255,255,255,0.07);
  }

  html { scroll-behavior: smooth; }

  body {
    min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: url('https://cdn.quietterminal.co.uk/misc/DarkBackground.png') center/cover fixed no-repeat;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    color: var(--text);
  }

  .card {
    background: var(--card-bg);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 36px 32px;
    width: 100%;
    max-width: 740px;
    box-shadow: 0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
  }

  /* ── Header ── */
  .header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 28px;
  }
  .creeper-icon {
    width: 40px; height: 40px;
    flex-shrink: 0;
    image-rendering: pixelated;
  }
  .header-text h1 {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.3px;
    color: #fff;
  }
  .header-text p {
    font-size: 0.78rem;
    color: var(--muted);
    margin-top: 2px;
  }

  /* ── Status Hero ── */
  .status-hero {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 20px 24px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    margin-bottom: 20px;
    transition: border-color 0.4s;
  }
  .status-hero.is-up { border-color: rgba(74,222,128,0.25); background: var(--up-dim); }
  .status-hero.is-down { border-color: rgba(248,113,113,0.25); background: var(--down-dim); }

  .pulse-ring {
    position: relative;
    width: 48px; height: 48px;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .pulse-ring::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--up);
    opacity: 0;
    animation: ping 2s cubic-bezier(0,0,0.2,1) infinite;
  }
  .pulse-ring.down::before { background: var(--down); }
  .pulse-dot {
    width: 20px; height: 20px;
    border-radius: 50%;
    background: var(--up);
    position: relative; z-index: 1;
    box-shadow: 0 0 12px var(--up);
  }
  .pulse-dot.down { background: var(--down); box-shadow: 0 0 12px var(--down); }
  .pulse-ring.down::before { animation: none; opacity: 0.25; }

  @keyframes ping {
    75%, 100% { transform: scale(2.2); opacity: 0; }
  }

  .status-label { flex: 1; }
  .status-label .main {
    font-size: 1.25rem;
    font-weight: 700;
    color: #fff;
  }
  .status-label .sub {
    font-size: 0.8rem;
    color: var(--muted);
    margin-top: 3px;
  }

  .status-code-badge {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
    padding: 4px 10px;
    border-radius: 8px;
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--border);
    color: var(--muted);
    flex-shrink: 0;
  }

  /* ── Stats Row ── */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }
  .stat-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    text-align: center;
    transition: background 0.2s;
  }
  .stat-box:hover { background: var(--surface-hover); }
  .stat-box .val {
    font-size: 1.55rem;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.5px;
    line-height: 1;
  }
  .stat-box .val.up { color: var(--up); }
  .stat-box .val.down { color: var(--down); }
  .stat-box .label {
    font-size: 0.72rem;
    color: var(--muted);
    margin-top: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* ── Timeline ── */
  .section-title {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--muted);
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .section-title span { font-size: 0.68rem; }

  .timeline-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 20px;
  }
  .timeline-bars {
    display: flex;
    gap: 3px;
    height: 36px;
    align-items: stretch;
    overflow: hidden;
  }
  .t-bar {
    flex: 1;
    min-width: 4px;
    border-radius: 3px;
    background: #2a2a3a;
    cursor: pointer;
    transition: filter 0.15s, transform 0.15s;
    position: relative;
  }
  .t-bar.up { background: var(--up); }
  .t-bar.down { background: var(--down); }
  .t-bar:hover { filter: brightness(1.3); transform: scaleY(1.08); }

  .timeline-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
  }
  .timeline-labels span {
    font-size: 0.68rem;
    color: var(--muted);
  }

  /* ── Tooltip ── */
  #tooltip {
    position: fixed;
    pointer-events: none;
    background: rgba(10,10,20,0.95);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.75rem;
    color: var(--text);
    z-index: 999;
    opacity: 0;
    transition: opacity 0.15s;
    white-space: nowrap;
  }
  #tooltip.show { opacity: 1; }

  /* ── Response Time Chart ── */
  .chart-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 20px;
  }
  #rt-chart {
    width: 100%;
    height: 110px;
    display: block;
    overflow: visible;
  }

  /* ── Recent Checks Table ── */
  .checks-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .check-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    padding: 11px 16px;
    border-bottom: 1px solid var(--border);
    gap: 12px;
    transition: background 0.15s;
  }
  .check-row:last-child { border-bottom: none; }
  .check-row:hover { background: var(--surface-hover); }
  .check-time {
    font-size: 0.8rem;
    color: var(--muted);
    font-family: 'SF Mono', 'Fira Code', monospace;
  }
  .check-code {
    font-size: 0.78rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(255,255,255,0.05);
  }
  .check-badge {
    font-size: 0.72rem;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .check-badge.up { background: var(--up-dim); color: var(--up); }
  .check-badge.down { background: var(--down-dim); color: var(--down); }

  /* ── Footer ── */
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.73rem;
    color: var(--muted);
  }
  .refresh-timer {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .refresh-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--up);
    animation: pulse-slow 2s ease-in-out infinite;
  }
  @keyframes pulse-slow {
    0%, 100% { opacity: 1; } 50% { opacity: 0.3; }
  }

  /* ── Loading ── */
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px;
    color: var(--muted);
  }
  .spinner {
    width: 28px; height: 28px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Responsive ── */
  @media (max-width: 520px) {
    .card { padding: 24px 18px; }
    .stats-row { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat-box .val { font-size: 1.2rem; }
    .stat-box { padding: 12px 8px; }
    .header-text h1 { font-size: 1rem; }
    .status-hero { padding: 16px; }
    .status-label .main { font-size: 1.05rem; }
    .check-row { grid-template-columns: 1fr auto auto; gap: 8px; }
    .check-time { font-size: 0.72rem; }
  }
</style>
</head>
<body>
<div id="tooltip"></div>

<div class="card">
  <!-- Header -->
  <div class="header">
    <svg class="creeper-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <rect width="16" height="16" fill="#3a7a3a"/>
      <rect x="1" y="1" width="6" height="6" fill="#2d5e2d"/>
      <rect x="9" y="1" width="6" height="6" fill="#2d5e2d"/>
      <rect x="3" y="2" width="2" height="2" fill="#050505"/>
      <rect x="11" y="2" width="2" height="2" fill="#050505"/>
      <rect x="6" y="6" width="4" height="2" fill="#050505"/>
      <rect x="5" y="8" width="6" height="1" fill="#050505"/>
      <rect x="4" y="9" width="3" height="2" fill="#050505"/>
      <rect x="9" y="9" width="3" height="2" fill="#050505"/>
      <rect x="1" y="7" width="14" height="8" fill="#4a9a4a"/>
      <rect x="6" y="7" width="4" height="2" fill="#2d5e2d"/>
      <rect x="5" y="9" width="2" height="3" fill="#2d5e2d"/>
      <rect x="9" y="9" width="2" height="3" fill="#2d5e2d"/>
    </svg>
    <div class="header-text">
      <h1>Mojang Authentication Status</h1>
      <p>sessionserver.mojang.com &mdash; checked every 5 minutes</p>
    </div>
  </div>

  <!-- Content (shown after data loads) -->
  <div id="content">
    <div class="loading">
      <div class="spinner"></div>
      <span>Fetching status&hellip;</span>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <span id="last-updated">Loading&hellip;</span>
    <div class="refresh-timer">
      <div class="refresh-dot"></div>
      <span id="refresh-countdown">Refresh in 30s</span>
    </div>
  </div>
</div>

<script>
(function () {
  const tooltip = document.getElementById('tooltip');
  let refreshTimer = 30;
  let countdown;

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtUptime(v) {
    if (v === null) return '—';
    const cls = v >= 99 ? 'up' : v >= 95 ? '' : 'down';
    return \`<span class="val \${cls}">\${v}%</span>\`;
  }

  function showTip(e, html) {
    tooltip.innerHTML = html;
    tooltip.classList.add('show');
    moveTip(e);
  }
  function moveTip(e) {
    const x = e.clientX + 14, y = e.clientY - 40;
    tooltip.style.left = Math.min(x, window.innerWidth - tooltip.offsetWidth - 10) + 'px';
    tooltip.style.top = Math.max(y, 8) + 'px';
  }
  function hideTip() { tooltip.classList.remove('show'); }

  function buildTimeline(recent) {
    const bars = recent.map((c, i) => {
      const cls = c.s === 'up' ? 'up' : c.s === 'down' ? 'down' : '';
      return \`<div class="t-bar \${cls}" data-i="\${i}"></div>\`;
    }).join('');

    const oldest = recent.length ? fmtTime(recent[0].t) : '';
    const newest = recent.length ? fmtTime(recent[recent.length - 1].t) : '';

    return \`
      <div class="timeline-bars" id="t-bars">\${bars}</div>
      <div class="timeline-labels">
        <span>\${oldest}</span>
        <span>\${newest}</span>
      </div>\`;
  }

  function buildRtChart(recent) {
    const pts = recent.filter(c => c.s === 'up');
    if (pts.length < 2) return '<p style="color:var(--muted);font-size:0.8rem;text-align:center;padding:20px">Not enough data yet</p>';

    const W = 680, H = 90, PAD = { t: 8, b: 24, l: 36, r: 8 };
    const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
    const vals = pts.map(c => c.r);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const range = maxV - minV || 1;

    const px = (i) => PAD.l + (i / (pts.length - 1)) * cW;
    const py = (v) => PAD.t + cH - ((v - minV) / range) * cH;

    const coords = pts.map((c, i) => [px(i), py(c.r)]);
    const linePath = 'M ' + coords.map(([x, y]) => \`\${x},\${y}\`).join(' L ');
    const areaPath = linePath + \` L \${coords[coords.length-1][0]},\${PAD.t + cH} L \${PAD.l},\${PAD.t + cH} Z\`;

    const gradId = 'rtg' + Date.now();
    const avgMs = Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);

    const yLabels = [minV, Math.round((minV+maxV)/2), maxV].map(v =>
      \`<text x="\${PAD.l - 4}" y="\${py(v) + 4}" text-anchor="end" fill="#6b7280" font-size="9">\${v}ms</text>\`
    ).join('');

    const dots = coords.map(([x, y], i) =>
      \`<circle cx="\${x}" cy="\${y}" r="10" fill="transparent" class="rt-dot" data-i="\${i}" data-r="\${pts[i].r}" data-t="\${pts[i].t}"/>\`
    ).join('');
    const visibleDots = coords.map(([x, y], i) => {
      const isFirst = i === 0, isLast = i === coords.length - 1;
      if (!isFirst && !isLast) return '';
      return \`<circle cx="\${x}" cy="\${y}" r="3" fill="#6366f1" stroke="rgba(99,102,241,0.3)" stroke-width="5"/>\`;
    }).join('');

    return \`
      <svg id="rt-chart" viewBox="0 0 \${W} \${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="\${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <line x1="\${PAD.l}" y1="\${PAD.t}" x2="\${PAD.l}" y2="\${PAD.t+cH}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        <line x1="\${PAD.l}" y1="\${PAD.t+cH}" x2="\${PAD.l+cW}" y2="\${PAD.t+cH}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        \${[0.25, 0.5, 0.75].map(f =>
          \`<line x1="\${PAD.l}" y1="\${PAD.t + cH * (1-f)}" x2="\${PAD.l+cW}" y2="\${PAD.t + cH * (1-f)}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>\`
        ).join('')}
        \${yLabels}
        <path d="\${areaPath}" fill="url(#\${gradId})"/>
        <path d="\${linePath}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        \${visibleDots}
        \${dots}
        <text x="\${PAD.l + cW}" y="\${H - 4}" text-anchor="end" fill="#6b7280" font-size="9">avg \${avgMs}ms</text>
      </svg>\`;
  }

  function buildChecks(recent) {
    return recent.slice().reverse().slice(0, 8).map(c => {
      const statusCls = c.s === 'up' ? 'up' : 'down';
      const statusLabel = c.s === 'up' ? 'Operational' : 'Down';
      const code = c.c ? c.c : '—';
      return \`
        <div class="check-row">
          <span class="check-time">\${fmtDate(c.t)}</span>
          <span class="check-code">\${code}</span>
          <span class="check-badge \${statusCls}">\${statusLabel}</span>
        </div>\`;
    }).join('');
  }

  function render(data) {
    const cur = data.current;
    const isUp = cur && cur.s === 'up';
    const heroClass = !cur ? '' : isUp ? 'is-up' : 'is-down';
    const dotClass = !cur ? '' : isUp ? '' : 'down';
    const ringClass = !cur ? '' : isUp ? '' : 'down';
    const mainLabel = !cur ? 'Awaiting first check…' : isUp ? 'All Systems Operational' : 'Service Disruption Detected';
    const subLabel = !cur ? 'No data yet.' : \`HTTP \${cur.c || '—'} &mdash; \${cur.r}ms response &mdash; checked \${fmtTime(cur.t)}\`;

    const html = \`
      <div class="status-hero \${heroClass}">
        <div class="pulse-ring \${ringClass}">
          <div class="pulse-dot \${dotClass}"></div>
        </div>
        <div class="status-label">
          <div class="main">\${mainLabel}</div>
          <div class="sub">\${subLabel}</div>
        </div>
        \${cur ? \`<div class="status-code-badge">HTTP \${cur.c || '×'}</div>\` : ''}
      </div>

      <div class="stats-row">
        <div class="stat-box">
          \${fmtUptime(data.uptime24h)}
          <div class="label">24h uptime</div>
        </div>
        <div class="stat-box">
          \${fmtUptime(data.uptime7d)}
          <div class="label">7d uptime</div>
        </div>
        <div class="stat-box">
          \${fmtUptime(data.uptime30d)}
          <div class="label">30d uptime</div>
        </div>
      </div>

      <div class="timeline-wrap">
        <div class="section-title">
          Last 90 checks
          <span>Each bar = 5 minutes</span>
        </div>
        \${buildTimeline(data.recent)}
      </div>

      <div class="chart-wrap">
        <div class="section-title">
          Response time
          <span>Successful checks only</span>
        </div>
        \${buildRtChart(data.recent)}
      </div>

      <div class="checks-wrap">
        <div class="section-title" style="padding: 12px 16px 0; margin-bottom: 0;">
          Recent checks
        </div>
        \${buildChecks(data.recent)}
      </div>
    \`;

    document.getElementById('content').innerHTML = html;
    document.getElementById('last-updated').textContent = 'Last updated: ' + fmtTime(Date.now());

    document.querySelectorAll('.t-bar').forEach((bar, i) => {
      const c = data.recent[i];
      if (!c) return;
      bar.addEventListener('mouseenter', e => {
        showTip(e, \`<strong style="color:\${c.s==='up'?'var(--up)':'var(--down)'}">\${c.s==='up'?'Operational':'Down'}</strong><br>\${fmtDate(c.t)}<br>HTTP \${c.c||'—'} &mdash; \${c.r}ms\`);
      });
      bar.addEventListener('mousemove', moveTip);
      bar.addEventListener('mouseleave', hideTip);
    });

    document.querySelectorAll('.rt-dot').forEach(dot => {
      const r = dot.dataset.r, t = dot.dataset.t;
      dot.addEventListener('mouseenter', e => {
        showTip(e, \`<strong style="color:#818cf8">\${r}ms</strong><br>\${fmtDate(+t)}\`);
      });
      dot.addEventListener('mousemove', moveTip);
      dot.addEventListener('mouseleave', hideTip);
    });
  }

  async function load() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      render(data);
    } catch (e) {
      document.getElementById('content').innerHTML =
        '<div class="loading"><span style="color:var(--down)">Failed to load status data.</span></div>';
    }
  }

  function startCountdown() {
    clearInterval(countdown);
    refreshTimer = 30;
    countdown = setInterval(() => {
      refreshTimer--;
      document.getElementById('refresh-countdown').textContent = \`Refresh in \${refreshTimer}s\`;
      if (refreshTimer <= 0) {
        load();
        refreshTimer = 30;
      }
    }, 1000);
  }

  load();
  startCountdown();
})();
</script>
</body>
</html>`;
}
