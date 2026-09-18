import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { performCheck, startScheduler } from './monitor.js';
import { computeStatusData, renderPage } from './render.js';

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url));
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES) || 5;
const ENABLE_TRIGGER = process.env.ENABLE_TRIGGER === 'true';
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const CONTENT_TYPES = {
  '.html': 'text/html;charset=UTF-8',
  '.css': 'text/css;charset=UTF-8',
  '.js': 'text/javascript;charset=UTF-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain;charset=UTF-8',
};

const db = openDatabase(DATA_DIR);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, 'Internal server error', 'text/plain');
    else res.end();
  }
});

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') {
    return send(res, 200, renderPage(statusData()), CONTENT_TYPES['.html']);
  }

  if (url.pathname === '/api/status') {
    return sendJson(res, statusData(), 200, {
      'Access-Control-Allow-Origin': '*',
    });
  }

  if (url.pathname === '/api/trigger' && ENABLE_TRIGGER) {
    await performCheck(db);
    return sendJson(res, { ok: true });
  }

  if (url.pathname === '/api/subscribe') {
    return handleSubscribe(req, res);
  }

  return serveStatic(url.pathname, res);
}

function statusData() {
  return { ...computeStatusData(db.readChecks()), intervalMinutes: CHECK_INTERVAL_MINUTES };
}

function send(res, status, body, contentType, headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...headers });
  res.end(body);
}

function sendJson(res, data, status = 200, headers = {}) {
  send(res, status, JSON.stringify(data), 'application/json', headers);
}

async function serveStatic(pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad request', 'text/plain');
  }

  const filePath = normalize(join(PUBLIC_DIR, decoded));
  if (!filePath.startsWith(PUBLIC_DIR + sep)) {
    return send(res, 404, 'Not found', 'text/plain');
  }

  try {
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] || 'application/octet-stream';
    return send(res, 200, body, type, { 'Cache-Control': 'public, max-age=300' });
  } catch {
    return send(res, 404, 'Not found', 'text/plain');
  }
}

async function readBody(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isDiscordWebhook(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'discord.com' ||
        u.hostname === 'discordapp.com' ||
        u.hostname.endsWith('.discord.com')) &&
      u.pathname.startsWith('/api/webhooks/')
    );
  } catch {
    return false;
  }
}

async function handleSubscribe(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, { error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, { error: 'Invalid JSON' }, 400);
  }

  const url = body?.url;
  if (!url || typeof url !== 'string') {
    return sendJson(res, { error: 'Missing url' }, 400);
  }
  if (!isDiscordWebhook(url)) {
    return sendJson(res, { error: 'Not a valid Discord webhook URL' }, 400);
  }

  if (db.hasWebhook(url)) {
    db.removeWebhook(url);
    return sendJson(res, { subscribed: false });
  }

  db.addWebhook(url);
  return sendJson(res, { subscribed: true });
}

const stopScheduler = startScheduler(db, CHECK_INTERVAL_MINUTES * 60000);

server.listen(PORT, HOST, () => {
  console.log(`mojauth-status listening on http://${HOST}:${PORT}`);
});

function shutdown() {
  stopScheduler();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
