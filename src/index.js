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
