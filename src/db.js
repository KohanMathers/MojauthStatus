import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MAX_CHECKS = 2016;

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'mojauth.db'));

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      t INTEGER NOT NULL,
      s TEXT NOT NULL,
      c INTEGER NOT NULL,
      r INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhooks (
      url TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
  `);

  const stmts = {
    readChecks: db.prepare('SELECT t, s, c, r FROM checks ORDER BY id'),
    lastCheck: db.prepare('SELECT t, s, c, r FROM checks ORDER BY id DESC LIMIT 1'),
    insertCheck: db.prepare('INSERT INTO checks (t, s, c, r) VALUES (?, ?, ?, ?)'),
    pruneChecks: db.prepare(
      'DELETE FROM checks WHERE id <= (SELECT id FROM checks ORDER BY id DESC LIMIT 1 OFFSET ?)'
    ),
    findWebhook: db.prepare('SELECT url FROM webhooks WHERE url = ?'),
    insertWebhook: db.prepare('INSERT INTO webhooks (url, created_at) VALUES (?, ?)'),
    deleteWebhook: db.prepare('DELETE FROM webhooks WHERE url = ?'),
    listWebhooks: db.prepare('SELECT url FROM webhooks'),
  };

  return {
    readChecks: () => stmts.readChecks.all(),
    lastCheck: () => stmts.lastCheck.get() ?? null,
    appendCheck(check) {
      stmts.insertCheck.run(check.t, check.s, check.c, check.r);
      stmts.pruneChecks.run(MAX_CHECKS);
    },
    hasWebhook: (url) => !!stmts.findWebhook.get(url),
    addWebhook: (url) => stmts.insertWebhook.run(url, Date.now()),
    removeWebhook: (url) => stmts.deleteWebhook.run(url),
    listWebhooks: () => stmts.listWebhooks.all().map((row) => row.url),
    close: () => db.close(),
  };
}
