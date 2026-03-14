(function () {
  document.documentElement.classList.add('js');
  const tooltip = document.getElementById('tooltip');
  let refreshTimer = 30;
  let countdown;
  let lastData = null;
  let use24h = localStorage.getItem('clock24') === '1';

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !use24h });
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: !use24h });
  }
  function fmtUptime(v) {
    if (v === null) return '—';
    const cls = v >= 99 ? 'up' : v >= 95 ? '' : 'down';
    return `<span class="val ${cls}">${v}%</span>`;
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
      return `<div class="t-bar ${cls}" data-i="${i}"></div>`;
    }).join('');

    const oldest = recent.length ? fmtTime(recent[0].t) : '';
    const newest = recent.length ? fmtTime(recent[recent.length - 1].t) : '';

    return `
      <div class="timeline-bars" id="t-bars">${bars}</div>
      <div class="timeline-labels">
        <span>${oldest}</span>
        <span>${newest}</span>
      </div>`;
  }

  function buildRtChart(recent, W) {
    const pts = recent.filter(c => c.s === 'up');
    if (pts.length < 2) return '<p style="color:var(--muted);font-size:0.8rem;text-align:center;padding:20px">Not enough data yet</p>';

    W = W || 680;
    const H = 110, PAD = { t: 8, b: 24, l: 36, r: 8 };
    const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
    const vals = pts.map(c => c.r);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const range = maxV - minV || 1;

    const px = (i) => PAD.l + (i / (pts.length - 1)) * cW;
    const py = (v) => PAD.t + cH - ((v - minV) / range) * cH;

    const coords = pts.map((c, i) => [px(i), py(c.r)]);
    const linePath = 'M ' + coords.map(([x, y]) => `${x},${y}`).join(' L ');
    const areaPath = linePath + ` L ${coords[coords.length-1][0]},${PAD.t + cH} L ${PAD.l},${PAD.t + cH} Z`;

    const gradId = 'rtg' + Date.now();
    const avgMs = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

    const yLabels = [minV, Math.round((minV + maxV) / 2), maxV].map(v =>
      `<text x="${PAD.l - 4}" y="${py(v) + 4}" text-anchor="end" fill="#6b7280" font-size="9">${v}ms</text>`
    ).join('');

    const dots = coords.map(([x, y], i) =>
      `<circle cx="${x}" cy="${y}" r="10" fill="transparent" class="rt-dot" data-i="${i}" data-r="${pts[i].r}" data-t="${pts[i].t}"/>`
    ).join('');
    const visibleDots = coords.map(([x, y], i) => {
      const isFirst = i === 0, isLast = i === coords.length - 1;
      if (!isFirst && !isLast) return '';
      return `<circle cx="${x}" cy="${y}" r="3" fill="#6366f1" stroke="rgba(99,102,241,0.3)" stroke-width="5"/>`;
    }).join('');

    return `
      <svg id="rt-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${PAD.t+cH}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        <line x1="${PAD.l}" y1="${PAD.t+cH}" x2="${PAD.l+cW}" y2="${PAD.t+cH}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        ${[0.25, 0.5, 0.75].map(f =>
          `<line x1="${PAD.l}" y1="${PAD.t + cH * (1-f)}" x2="${PAD.l+cW}" y2="${PAD.t + cH * (1-f)}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>`
        ).join('')}
        ${yLabels}
        <path d="${areaPath}" fill="url(#${gradId})"/>
        <path d="${linePath}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${visibleDots}
        ${dots}
        <text x="${PAD.l + cW}" y="${H - 4}" text-anchor="end" fill="#6b7280" font-size="9">avg ${avgMs}ms</text>
      </svg>`;
  }

  function buildChecks(recent) {
    return recent.slice().reverse().slice(0, 8).map(c => {
      const statusCls = c.s === 'up' ? 'up' : 'down';
      const statusLabel = c.s === 'up' ? 'Operational' : 'Down';
      const code = c.c ? c.c : '—';
      return `
        <div class="check-row">
          <span class="check-time">${fmtDate(c.t)}</span>
          <span class="check-code">${code}</span>
          <span class="check-badge ${statusCls}">${statusLabel}</span>
        </div>`;
    }).join('');
  }

  function render(data) {
    lastData = data;
    const cur = data.current;
    const isUp = cur && cur.s === 'up';
    const heroClass = !cur ? '' : isUp ? 'is-up' : 'is-down';
    const dotClass = !cur ? '' : isUp ? '' : 'down';
    const ringClass = !cur ? '' : isUp ? '' : 'down';
    const mainLabel = !cur ? 'Awaiting first check…' : isUp ? 'All Systems Operational' : 'Service Disruption Detected';
    const subLabel = !cur ? 'No data yet.' : `HTTP ${cur.c || '—'} &mdash; ${cur.r}ms response &mdash; checked ${fmtTime(cur.t)}`;

    const html = `
      <div class="status-hero ${heroClass}">
        <div class="pulse-ring ${ringClass}">
          <div class="pulse-dot ${dotClass}"></div>
        </div>
        <div class="status-label">
          <div class="main">${mainLabel}</div>
          <div class="sub">${subLabel}</div>
        </div>
        ${cur ? `<div class="status-code-badge">HTTP ${cur.c || '×'}</div>` : ''}
      </div>

      <div class="stats-row">
        <div class="stat-box">
          ${fmtUptime(data.uptime24h)}
          <div class="label">24h uptime</div>
        </div>
        <div class="stat-box">
          ${fmtUptime(data.uptime7d)}
          <div class="label">7d uptime</div>
        </div>
        <div class="stat-box">
          ${fmtUptime(data.uptime30d)}
          <div class="label">30d uptime</div>
        </div>
      </div>

      <div class="timeline-wrap">
        <div class="section-title">
          Last 90 checks
          <span>Each bar = 5 minutes</span>
        </div>
        ${buildTimeline(data.recent)}
      </div>

      <div class="chart-wrap">
        <div class="section-title">
          Response time
          <span>Successful checks only</span>
        </div>
        <div id="rt-chart-container"></div>
      </div>

      <div class="checks-wrap">
        <div class="section-title" style="padding: 12px 16px 0; margin-bottom: 0;">
          Recent checks
        </div>
        ${buildChecks(data.recent)}
      </div>
    `;

    document.getElementById('content').innerHTML = html;
    document.getElementById('last-updated').textContent = 'Last updated: ' + fmtTime(Date.now());

    const rtContainer = document.getElementById('rt-chart-container');
    if (rtContainer) {
      const innerW = rtContainer.closest('.chart-wrap').clientWidth - 32;
      rtContainer.innerHTML = buildRtChart(data.recent, innerW);
      rtContainer.querySelectorAll('.rt-dot').forEach(dot => {
        const r = dot.dataset.r, t = dot.dataset.t;
        dot.addEventListener('mouseenter', e => {
          showTip(e, `<strong style="color:#818cf8">${r}ms</strong><br>${fmtDate(+t)}`);
        });
        dot.addEventListener('mousemove', moveTip);
        dot.addEventListener('mouseleave', hideTip);
      });
    }

    document.querySelectorAll('.t-bar').forEach((bar, i) => {
      const c = data.recent[i];
      if (!c) return;
      bar.addEventListener('mouseenter', e => {
        showTip(e, `<strong style="color:${c.s==='up'?'var(--up)':'var(--down)'}">${c.s==='up'?'Operational':'Down'}</strong><br>${fmtDate(c.t)}<br>HTTP ${c.c||'—'} &mdash; ${c.r}ms`);
      });
      bar.addEventListener('mousemove', moveTip);
      bar.addEventListener('mouseleave', hideTip);
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
      document.getElementById('refresh-countdown').textContent = `Refresh in ${refreshTimer}s`;
      if (refreshTimer <= 0) {
        load();
        refreshTimer = 30;
      }
    }, 1000);
  }

  const clockToggle = document.getElementById('clock-toggle');
  function updateToggle() { clockToggle.textContent = use24h ? '24h' : '12h'; }
  updateToggle();
  clockToggle.addEventListener('click', () => {
    use24h = !use24h;
    localStorage.setItem('clock24', use24h ? '1' : '0');
    updateToggle();
    if (lastData) render(lastData);
  });

  const readmeButton = document.getElementById('readme-button');
  const readmeModal = document.getElementById('readme-modal');
  if (readmeButton && readmeModal) {
    const closeModal = () => {
      readmeModal.classList.remove('open');
      readmeModal.setAttribute('aria-hidden', 'true');
    };
    const openModal = () => {
      readmeModal.classList.add('open');
      readmeModal.setAttribute('aria-hidden', 'false');
    };

    readmeButton.addEventListener('click', openModal);
    readmeModal.querySelectorAll('[data-close="readme"]').forEach(el => {
      el.addEventListener('click', closeModal);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  load();
  startCountdown();
})();
