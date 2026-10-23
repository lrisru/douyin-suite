import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureDir, nowMs, resolveDataPath } from './util.js';

let db = null;
let dbPath = '';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT DEFAULT '',
  profile_dir TEXT NOT NULL,
  cdp_port INTEGER NOT NULL,
  status TEXT DEFAULT 'offline',
  logged_in INTEGER DEFAULT 0,
  nickname TEXT DEFAULT '',
  uid TEXT DEFAULT '',
  sec_uid TEXT DEFAULT '',
  proxy TEXT DEFAULT '',
  created_at INTEGER,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  task_id INTEGER,
  keyword TEXT DEFAULT '',
  aweme_id TEXT,
  desc TEXT,
  author TEXT,
  author_uid TEXT,
  author_sec_uid TEXT,
  digg INTEGER DEFAULT 0,
  comment INTEGER DEFAULT 0,
  collect INTEGER DEFAULT 0,
  share INTEGER DEFAULT 0,
  create_time INTEGER DEFAULT 0,
  url TEXT,
  raw TEXT,
  collected_at INTEGER,
  UNIQUE(aweme_id, account_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  task_id INTEGER,
  keyword TEXT DEFAULT '',
  sec_uid TEXT,
  uid TEXT,
  unique_id TEXT,
  nickname TEXT,
  signature TEXT,
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  total_favorited INTEGER DEFAULT 0,
  avatar TEXT,
  raw TEXT,
  collected_at INTEGER,
  UNIQUE(sec_uid, account_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  task_id INTEGER,
  keyword TEXT DEFAULT '',
  aweme_id TEXT,
  cid TEXT,
  text TEXT,
  user_name TEXT,
  user_uid TEXT,
  user_sec_uid TEXT DEFAULT '',
  digg INTEGER DEFAULT 0,
  create_time INTEGER DEFAULT 0,
  raw TEXT,
  collected_at INTEGER,
  UNIQUE(cid, account_id)
);

CREATE TABLE IF NOT EXISTS lives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  task_id INTEGER,
  web_rid TEXT,
  room_id TEXT,
  title TEXT,
  anchor TEXT,
  online INTEGER DEFAULT 0,
  url TEXT,
  raw TEXT,
  collected_at INTEGER,
  UNIQUE(web_rid, room_id, account_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  params TEXT DEFAULT '{}',
  account_id INTEGER,
  status TEXT DEFAULT 'pending',
  total INTEGER DEFAULT 0,
  done INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  error TEXT DEFAULT '',
  result TEXT DEFAULT '',
  created_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER,
  level TEXT,
  scope TEXT,
  msg TEXT
);

CREATE TABLE IF NOT EXISTS proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE,
  status TEXT DEFAULT 'unknown',
  latency INTEGER DEFAULT 0,
  exit_ip TEXT DEFAULT '',
  checked_at INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  task_id INTEGER,
  conversation_id TEXT,
  nickname TEXT,
  sec_uid TEXT,
  uid TEXT,
  unread INTEGER DEFAULT 0,
  last_message TEXT,
  last_time INTEGER DEFAULT 0,
  raw TEXT,
  collected_at INTEGER,
  UNIQUE(conversation_id, account_id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  params TEXT DEFAULT '{}',
  account_ids TEXT DEFAULT '',
  interval_min INTEGER DEFAULT 60,
  enabled INTEGER DEFAULT 1,
  last_run INTEGER DEFAULT 0,
  next_run INTEGER DEFAULT 0,
  last_task_id INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS live_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  web_rid TEXT,
  room_id TEXT,
  type TEXT,
  method TEXT,
  user_name TEXT,
  user_id TEXT,
  content TEXT,
  extra TEXT,
  ts INTEGER
);

CREATE INDEX IF NOT EXISTS idx_items_task ON items(task_id);
CREATE INDEX IF NOT EXISTS idx_items_kw ON items(keyword);
CREATE INDEX IF NOT EXISTS idx_users_kw ON users(keyword);
CREATE INDEX IF NOT EXISTS idx_comments_aweme ON comments(aweme_id);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
CREATE INDEX IF NOT EXISTS idx_live_room ON live_messages(web_rid, ts);
CREATE INDEX IF NOT EXISTS idx_live_type ON live_messages(type, ts);
`;

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  desc, author, keyword, tokenize='unicode61'
);
CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(
  nickname, signature, keyword, tokenize='unicode61'
);
`;

/** 中文按字拆开，unicode61 才能做子串检索 */
export function segment(text) {
  return String(text ?? '')
    .replace(/[\u4e00-\u9fff]/g, (m) => ` ${m} `)
    .replace(/[\s]+/g, ' ')
    .trim();
}

export function initDb(config) {
  const dir = ensureDir(resolveDataPath(config));
  dbPath = path.join(dir, 'douyin.db');
  db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.exec(FTS_SCHEMA);
  // 轻量迁移：老库补列（必须在回填之前）
  for (const sql of [
    'ALTER TABLE tasks ADD COLUMN result TEXT DEFAULT ""',
    'ALTER TABLE accounts ADD COLUMN seed TEXT DEFAULT ""',
    'ALTER TABLE comments ADD COLUMN keyword TEXT DEFAULT ""',
    'ALTER TABLE comments ADD COLUMN user_sec_uid TEXT DEFAULT ""',
    'ALTER TABLE lives ADD COLUMN keyword TEXT DEFAULT ""',
  ]) {
    try { db.exec(sql); } catch { /* 已存在 */ }
  }
  // 历史评论回填关键词（从对应作品继承），只处理空值
  try {
    db.exec(`UPDATE comments SET keyword = COALESCE((SELECT i.keyword FROM items i WHERE i.aweme_id = comments.aweme_id LIMIT 1), '') WHERE (keyword IS NULL OR keyword = '')`);
  } catch { /* ignore */ }
  // 历史评论补 sec_uid（从 raw 里提取）
  try {
    const rows = db.prepare(`SELECT id, raw FROM comments WHERE (user_sec_uid IS NULL OR user_sec_uid = '') AND raw IS NOT NULL LIMIT 5000`).all();
    const upd = db.prepare('UPDATE comments SET user_sec_uid = ? WHERE id = ?');
    for (const r of rows) {
      try {
        const u = JSON.parse(r.raw)?.user;
        if (u?.sec_uid) upd.run(u.sec_uid, r.id);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return db;
}

export function getDb() {
  if (!db) throw new Error('db not initialized');
  return db;
}

export function dbFile() {
  return dbPath;
}

export function insertLog(item) {
  try {
    getDb().prepare('INSERT INTO logs (ts, level, scope, msg) VALUES (?,?,?,?)')
      .run(item.ts, item.level, item.scope, String(item.msg).slice(0, 2000));
  } catch { /* 日志写盘失败不影响主流程 */ }
}

export function pruneLogs(keep = 5000) {
  try {
    const d = getDb();
    const row = d.prepare('SELECT COUNT(*) AS c FROM logs').get();
    if (row.c > keep) {
      d.prepare(`DELETE FROM logs WHERE id <= (SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET ?)`).run(keep);
    }
  } catch { /* ignore */ }
}

/* ---------------- accounts ---------------- */

export function listAccounts() {
  return getDb().prepare('SELECT * FROM accounts ORDER BY id DESC').all();
}

export function getAccount(id) {
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(Number(id));
}

export function createAccount({ name, note = '', profile_dir, cdp_port, proxy = '' }) {
  const d = getDb();
  const r = d.prepare('INSERT INTO accounts (name, note, profile_dir, cdp_port, proxy, created_at) VALUES (?,?,?,?,?,?)')
    .run(name, note, profile_dir, cdp_port, proxy, nowMs());
  return getAccount(r.lastInsertRowid);
}

export function updateAccount(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getAccount(id);
  const sql = `UPDATE accounts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  getDb().prepare(sql).run(...keys.map((k) => fields[k]), Number(id));
  return getAccount(id);
}

export function deleteAccount(id) {
  const d = getDb();
  d.prepare('DELETE FROM accounts WHERE id = ?').run(Number(id));
}

/* ---------------- tasks ---------------- */

export function createTask({ type, params, account_id }) {
  const r = getDb().prepare('INSERT INTO tasks (type, params, account_id, status, created_at) VALUES (?,?,?,?,?)')
    .run(type, JSON.stringify(params || {}), account_id ? Number(account_id) : null, 'pending', nowMs());
  return getTask(r.lastInsertRowid);
}

export function getTask(id) {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
}

export function listTasks(limit = 100) {
  return getDb().prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?').all(Number(limit));
}

export function updateTask(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  getDb().prepare(sql).run(...keys.map((k) => fields[k]), Number(id));
}

export function bumpTask(id, field) {
  getDb().prepare(`UPDATE tasks SET ${field} = ${field} + 1 WHERE id = ?`).run(Number(id));
}

/* ---------------- data ---------------- */

export function upsertItem(row) {
  const sql = `INSERT INTO items (account_id, task_id, keyword, aweme_id, desc, author, author_uid, author_sec_uid,
      digg, comment, collect, share, create_time, url, raw, collected_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(aweme_id, account_id) DO UPDATE SET
      desc=excluded.desc, digg=excluded.digg, comment=excluded.comment,
      collect=excluded.collect, share=excluded.share, collected_at=excluded.collected_at, raw=excluded.raw`;
  getDb().prepare(sql).run(
    row.account_id ?? null, row.task_id ?? null, row.keyword ?? '', row.aweme_id, row.desc ?? '',
    row.author ?? '', row.author_uid ?? '', row.author_sec_uid ?? '',
    row.digg ?? 0, row.comment ?? 0, row.collect ?? 0, row.share ?? 0,
    row.create_time ?? 0, row.url ?? '', row.raw ? JSON.stringify(row.raw) : '', nowMs()
  );
  try {
    const d = getDb();
    const r = d.prepare('SELECT id FROM items WHERE aweme_id = ? AND account_id IS ?').get(row.aweme_id, row.account_id ?? null);
    if (r) {
      d.prepare('DELETE FROM items_fts WHERE rowid = ?').run(r.id);
      d.prepare('INSERT INTO items_fts(rowid, desc, author, keyword) VALUES (?,?,?,?)')
        .run(r.id, segment(row.desc), segment(row.author), segment(row.keyword));
    }
  } catch { /* FTS 同步失败不影响主流程 */ }
}

export function upsertUser(row) {
  const sql = `INSERT INTO users (account_id, task_id, keyword, sec_uid, uid, unique_id, nickname, signature,
      follower_count, following_count, total_favorited, avatar, raw, collected_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(sec_uid, account_id) DO UPDATE SET
      nickname=excluded.nickname, signature=excluded.signature,
      follower_count=excluded.follower_count, following_count=excluded.following_count,
      raw=excluded.raw, collected_at=excluded.collected_at`;
  getDb().prepare(sql).run(
    row.account_id ?? null, row.task_id ?? null, row.keyword ?? '', row.sec_uid ?? null,
    row.uid ?? '', row.unique_id ?? '', row.nickname ?? '', row.signature ?? '',
    row.follower_count ?? 0, row.following_count ?? 0, row.total_favorited ?? 0,
    row.avatar ?? '', row.raw ? JSON.stringify(row.raw) : '', nowMs()
  );
  try {
    const d = getDb();
    const r = d.prepare('SELECT id FROM users WHERE sec_uid = ? AND account_id IS ?').get(row.sec_uid ?? null, row.account_id ?? null);
    if (r) {
      d.prepare('DELETE FROM users_fts WHERE rowid = ?').run(r.id);
      d.prepare('INSERT INTO users_fts(rowid, nickname, signature, keyword) VALUES (?,?,?,?)')
        .run(r.id, segment(row.nickname), segment(row.signature), segment(row.keyword));
    }
  } catch { /* 同上 */ }
}

export function upsertComment(row) {
  // 关键词从对应作品继承，方便按关键词筛评论
  let keyword = row.keyword || '';
  if (!keyword && row.aweme_id) {
    try {
      keyword = getDb().prepare('SELECT keyword FROM items WHERE aweme_id = ? LIMIT 1').get(row.aweme_id)?.keyword || '';
    } catch { /* ignore */ }
  }
  const sql = `INSERT INTO comments (account_id, task_id, keyword, aweme_id, cid, text, user_name, user_uid, user_sec_uid, digg, create_time, raw, collected_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(cid, account_id) DO UPDATE SET text=excluded.text, digg=excluded.digg,
      user_sec_uid=COALESCE(NULLIF(excluded.user_sec_uid,''), comments.user_sec_uid),
      collected_at=excluded.collected_at, keyword=excluded.keyword`;
  getDb().prepare(sql).run(
    row.account_id ?? null, row.task_id ?? null, keyword, row.aweme_id ?? '', row.cid, row.text ?? '',
    row.user_name ?? '', row.user_uid ?? '', row.user_sec_uid ?? '', row.digg ?? 0, row.create_time ?? 0,
    row.raw ? JSON.stringify(row.raw) : '', nowMs()
  );
}

export function upsertLive(row) {
  const sql = `INSERT INTO lives (account_id, task_id, keyword, web_rid, room_id, title, anchor, online, url, raw, collected_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(web_rid, room_id, account_id) DO UPDATE SET
      title=excluded.title, anchor=excluded.anchor, online=excluded.online,
      keyword=COALESCE(NULLIF(excluded.keyword,''), lives.keyword), collected_at=excluded.collected_at`;
  getDb().prepare(sql).run(
    row.account_id ?? null, row.task_id ?? null, row.keyword ?? '',
    row.web_rid ?? '', row.room_id ?? '',
    row.title ?? '', row.anchor ?? '', row.online ?? 0, row.url ?? '',
    row.raw ? JSON.stringify(row.raw) : '', nowMs()
  );
}

export function upsertConversation(row) {
  const sql = `INSERT INTO conversations (account_id, task_id, conversation_id, nickname, sec_uid, uid, unread, last_message, last_time, raw, collected_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(conversation_id, account_id) DO UPDATE SET
      nickname=excluded.nickname, unread=excluded.unread, last_message=excluded.last_message,
      last_time=excluded.last_time, collected_at=excluded.collected_at`;
  getDb().prepare(sql).run(
    row.account_id ?? null, row.task_id ?? null, row.conversation_id, row.nickname ?? '',
    row.sec_uid ?? '', row.uid ?? '', row.unread ?? 0, row.last_message ?? '',
    row.last_time ?? 0, row.raw ? JSON.stringify(row.raw) : '', nowMs()
  );
}

const TABLES = { items: 'items', users: 'users', comments: 'comments', lives: 'lives', conversations: 'conversations' };

function buildWhere(kind, { keyword = '', task_id = 0, account_id = 0, from = 0, to = 0 } = {}) {
  const where = [];
  const args = [];
  if (task_id) { where.push('task_id = ?'); args.push(Number(task_id)); }
  if (account_id) { where.push('account_id = ?'); args.push(Number(account_id)); }
  if (from) { where.push('collected_at >= ?'); args.push(Number(from)); }
  if (to) { where.push('collected_at <= ?'); args.push(Number(to)); }
  if (keyword) {
    const fts = kind === 'items' ? 'items_fts' : kind === 'users' ? 'users_fts' : '';
    if (fts) {
      const phrase = `"${segment(keyword)}"`;
      let ids = [];
      try {
        ids = getDb().prepare(`SELECT rowid AS id FROM ${fts} WHERE ${fts} MATCH ? LIMIT 5000`).all(phrase).map((r) => r.id);
      } catch { ids = []; }
      if (!ids.length) return { where: ['1 = 0'], args: [] };
      where.push(`id IN (${ids.map(() => '?').join(',')})`);
      args.push(...ids);
      return { where, args };
    }
    // 非 FTS 表按各自的文本列匹配（这些表没有 keyword 列）
    const columns = {
      comments: ['keyword', 'text', 'user_name'],
      lives: ['title', 'anchor', 'keyword'],
      conversations: ['nickname', 'last_message'],
    }[kind] || [];
    if (columns.length) {
      where.push(`(${columns.map((c) => `${c} LIKE ?`).join(' OR ')})`);
      for (const _ of columns) args.push(`%${keyword}%`);
    } else {
      where.push('keyword LIKE ?');
      args.push(`%${keyword}%`);
    }
  }
  return { where, args };
}

export function queryRows(kind, { limit = 200, offset = 0, order = 'id DESC', ...filters } = {}) {
  const table = TABLES[kind];
  if (!table) throw new Error('unknown kind ' + kind);
  const { where, args } = buildWhere(kind, filters);
  const sql = `SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ? OFFSET ?`;
  return getDb().prepare(sql).all(...args, Number(limit), Number(offset));
}

export function countRows(kind, filters = {}) {
  const table = TABLES[kind];
  const { where, args } = buildWhere(kind, filters);
  return getDb().prepare(`SELECT COUNT(*) AS c FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...args).c;
}

/* ---------------- 直播消息 ---------------- */

export function insertLiveMessage(row) {
  getDb().prepare(`INSERT INTO live_messages (account_id, web_rid, room_id, type, method, user_name, user_id, content, extra, ts)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    row.account_id ?? null, row.web_rid ?? '', row.room_id ?? '', row.type ?? 'other', row.method ?? '',
    row.user_name ?? '', row.user_id ?? '', row.content ?? '', JSON.stringify(row.extra || {}), row.ts || nowMs()
  );
}

export function queryLiveMessages({ web_rid = '', type = '', limit = 200, after_id = 0 } = {}) {
  const where = [];
  const args = [];
  if (web_rid) { where.push('web_rid = ?'); args.push(web_rid); }
  if (type) { where.push('type = ?'); args.push(type); }
  if (after_id) { where.push('id > ?'); args.push(Number(after_id)); }
  return getDb().prepare(`SELECT * FROM live_messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`)
    .all(...args, Number(limit));
}

export function pruneLiveMessages(keep = 200000) {
  try {
    getDb().prepare(`DELETE FROM live_messages WHERE id <= (SELECT id FROM live_messages ORDER BY id DESC LIMIT 1 OFFSET ?)`).run(keep);
  } catch { /* ignore */ }
}

/* ---------------- 定时任务 ---------------- */

export function listSchedules() {
  return getDb().prepare('SELECT * FROM schedules ORDER BY id DESC').all();
}

export function getSchedule(id) {
  return getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(Number(id));
}

export function createSchedule({ name, type, params = {}, account_ids = '', interval_min = 60 }) {
  const now = nowMs();
  const r = getDb().prepare(`INSERT INTO schedules (name, type, params, account_ids, interval_min, enabled, next_run, created_at)
    VALUES (?,?,?,?,?,1,?,?)`).run(name, type, JSON.stringify(params), account_ids, Number(interval_min) || 60, now + (Number(interval_min) || 60) * 60000, now);
  return getSchedule(r.lastInsertRowid);
}

export function updateSchedule(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getSchedule(id);
  getDb().prepare(`UPDATE schedules SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), Number(id));
  return getSchedule(id);
}

export function deleteSchedule(id) {
  getDb().prepare('DELETE FROM schedules WHERE id = ?').run(Number(id));
}

export function dueSchedules(now = nowMs()) {
  return getDb().prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_run > 0 AND next_run <= ?').all(now);
}

export function stats() {
  const d = getDb();
  const one = (sql, ...a) => d.prepare(sql).get(...a);
  return {
    accounts: one('SELECT COUNT(*) c FROM accounts').c,
    online: one("SELECT COUNT(*) c FROM accounts WHERE logged_in = 1").c,
    items: one('SELECT COUNT(*) c FROM items').c,
    users: one('SELECT COUNT(*) c FROM users').c,
    comments: one('SELECT COUNT(*) c FROM comments').c,
    lives: one('SELECT COUNT(*) c FROM lives').c,
    tasks: one('SELECT COUNT(*) c FROM tasks').c,
    running: one("SELECT COUNT(*) c FROM tasks WHERE status IN ('running','pending')").c,
    proxies: one('SELECT COUNT(*) c FROM proxies').c,
  };
}

/* ---------------- settings ---------------- */

export function getSetting(key, fallback = '') {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb().prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}

/* ---------------- proxies ---------------- */

export function listProxies() {
  return getDb().prepare('SELECT * FROM proxies ORDER BY id DESC').all();
}

export function addProxy(url) {
  getDb().prepare('INSERT INTO proxies (url, status) VALUES (?,?) ON CONFLICT(url) DO NOTHING').run(url, 'unknown');
}

export function removeProxy(id) {
  getDb().prepare('DELETE FROM proxies WHERE id = ?').run(Number(id));
}

export function updateProxy(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  getDb().prepare(`UPDATE proxies SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), Number(id));
}

export function pickProxy() {
  return getDb().prepare("SELECT * FROM proxies WHERE status = 'ok' ORDER BY latency ASC LIMIT 1").get();
}

export function queryLogs(limit = 200) {
  return getDb().prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(Number(limit));
}
