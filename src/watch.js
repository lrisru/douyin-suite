/**
 * 监控：博主新作品 / 视频新评论
 * 原版叫「博主监控」和「评论监听」，这里是轮询实现（不依赖推送）
 */
import { sleep, randInt, logger, events } from './util.js';
import * as db from './db.js';
import { notifyAll } from './notify.js';

const TICK_MS = 20000;

export class WatchManager {
  constructor({ douyin, host, config, notifyFn }) {
    this.douyin = douyin;
    this.host = host;
    this.config = config;
    this.notifyFn = notifyFn || notifyAll;
    this.timer = null;
    this.busy = false;
    this._ensureSchema();
  }

  _ensureSchema() {
    const d = db.getDb();
    d.exec(`CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target TEXT NOT NULL,
      note TEXT DEFAULT '',
      account_id INTEGER,
      interval_sec INTEGER DEFAULT 600,
      last_check INTEGER DEFAULT 0,
      last_cursor TEXT DEFAULT '',
      hits INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER
    )`);
  }

  list() {
    return db.getDb().prepare('SELECT * FROM watches ORDER BY id DESC').all();
  }

  add({ type, target, note = '', account_id = null, interval_sec = 600 }) {
    const d = db.getDb();
    const exist = d.prepare('SELECT id FROM watches WHERE type = ? AND target = ?').get(type, String(target));
    if (exist) {
      d.prepare('UPDATE watches SET enabled = 1, note = COALESCE(NULLIF(?, \'\'), note) WHERE id = ?').run(note, exist.id);
      return { id: exist.id, existed: true };
    }
    const r = d.prepare(`INSERT INTO watches (type, target, note, account_id, interval_sec, created_at)
      VALUES (?,?,?,?,?,?)`).run(type, String(target), note, account_id, interval_sec, Date.now());
    return { id: Number(r.lastInsertRowid), existed: false };
  }

  remove(id) {
    db.getDb().prepare('DELETE FROM watches WHERE id = ?').run(Number(id));
  }

  toggle(id, enabled) {
    db.getDb().prepare('UPDATE watches SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, Number(id));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    logger.info('watch', `监控已启动（每 ${TICK_MS / 1000}s 扫一次）`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      const due = db.getDb().prepare(`SELECT * FROM watches
        WHERE enabled = 1 AND (last_check = 0 OR last_check + interval_sec * 1000 <= ?) ORDER BY last_check ASC LIMIT 3`).all(now);
      for (const w of due) {
        try { await this.checkOne(w); } catch (e) { logger.warn('watch', `#${w.id} 检查失败: ${e.message}`); }
        await sleep(randInt(800, 2000));
      }
    } finally {
      this.busy = false;
    }
  }

  /** 手动立即检查 */
  async checkNow(id) {
    const w = db.getDb().prepare('SELECT * FROM watches WHERE id = ?').get(Number(id));
    if (!w) throw new Error('监控项不存在');
    return this.checkOne(w);
  }

  async checkOne(w) {
    const accs = db.listAccounts ? db.listAccounts() : [];
    const accId = w.account_id || (accs.find((a) => a.logged_in === 1)?.id) || accs[0]?.id;
    const account = db.getAccount ? db.getAccount(accId) : (accs.find((a) => a.id === accId));
    if (!account) throw new Error('没有可用账号');

    let added = 0;
    let cursor = w.last_cursor;

    if (w.type === 'user_new_works') {
      const { items } = await this.douyin.userWorks(account, { secUid: w.target, scrolls: 1, limit: 5 });
      const seen = new Set(w.last_cursor ? w.last_cursor.split(',') : []);
      const fresh = items.filter((it) => !seen.has(it.aweme_id));
      if (!w.last_cursor) {
        // 第一次只记录基线，不当作新作品
        cursor = items.slice(0, 5).map((i) => i.aweme_id).join(',');
      } else {
        for (const it of fresh) {
          db.upsertItem({ ...it, keyword: w.note || '监控', task_id: null, account_id: acc.id });
          added++;
        }
        cursor = items.slice(0, 10).map((i) => i.aweme_id).join(',');
      }
      if (added) {
        const titles = fresh.slice(0, 3).map((i) => (i.desc || '').slice(0, 24)).join(' / ');
        await this._fire(w, `【${w.note || '监控'}】发了 ${added} 条新作品：${titles}`);
      }
    } else if (w.type === 'video_new_comments') {
      const { comments } = await this.douyin.comments(account, { awemeId: w.target, scrolls: 2, limit: 50 });
      const seen = new Set(w.last_cursor ? w.last_cursor.split(',') : []);
      const fresh = comments.filter((c) => c.cid && !seen.has(c.cid));
      if (!w.last_cursor) {
        cursor = comments.slice(0, 50).map((c) => c.cid).join(',');
      } else {
        for (const c of fresh) {
          db.upsertComment({ ...c, aweme_id: w.target, keyword: w.note || '监控' });
          added++;
        }
        cursor = comments.slice(0, 60).map((c) => c.cid).join(',');
      }
      if (added) {
        const texts = fresh.slice(0, 3).map((c) => `${c.user_name}: ${(c.text || '').slice(0, 20)}`).join(' | ');
        await this._fire(w, `【${w.note || '监控'}】新增 ${added} 条评论：${texts}`);
      }
    } else {
      throw new Error('未知监控类型: ' + w.type);
    }

    db.getDb().prepare('UPDATE watches SET last_check = ?, last_cursor = ?, hits = hits + ? WHERE id = ?')
      .run(Date.now(), cursor || w.last_cursor || '', added, w.id);
    if (added) events.emit('watch', { id: w.id, type: w.type, added });
    return { ok: true, added, cursor: cursor ? 'updated' : 'baseline' };
  }

  async _fire(w, message) {
    logger.ok('watch', message);
    try {
      if (this.notifyFn) await this.notifyFn(this.config, message);
    } catch (e) {
      logger.warn('watch', '通知发送失败: ' + e.message);
    }
  }
}
