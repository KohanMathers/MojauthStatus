import { utcTime } from './render.js';

const MOJANG_URL =
  'https://sessionserver.mojang.com/session/minecraft/hasJoined?username=Steve&serverId=gibberish123';

export async function performCheck(db) {
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

  const lastCheck = db.lastCheck();

  const check = { t: Date.now(), s: status, c: statusCode, r: responseTime };
  db.appendCheck(check);

  if (status === 'down' && (!lastCheck || lastCheck.s === 'up')) {
    await notifyWebhooks(db, check);
  }

  return check;
}

async function notifyWebhooks(db, check) {
  const urls = db.listWebhooks();
  if (!urls.length) return;

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
    urls.map((url) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      })
    )
  );
}

// Fires on wall-clock multiples of the interval (like a "*/5 * * * *" cron),
// plus once at startup if the most recent check is already stale.
export function startScheduler(db, intervalMs) {
  let timer;

  const run = () =>
    performCheck(db).catch((err) => console.error('Check failed:', err));

  const scheduleNext = () => {
    const delay = intervalMs - (Date.now() % intervalMs);
    timer = setTimeout(() => {
      run();
      scheduleNext();
    }, delay);
  };

  const last = db.lastCheck();
  if (!last || Date.now() - last.t >= intervalMs) run();
  scheduleNext();

  return () => clearTimeout(timer);
}
