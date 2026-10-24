/**
 * 用 webcast/user 接口批量补全评论者资料
 * 原版工具就是这个套路：采评论拿 uid -> 调接口补性别/地区/简介/粉丝 -> 本地筛选
 */
import { loadConfig, sleep, randInt, logger } from './util.js';
import * as db from './db.js';

const API = 'https://live.douyin.com/webcast/user/?aid=6383&target_uid=';

/** 单条查询（在浏览器上下文里带 cookie） */
async function one(cdp, uid) {
  const r = await cdp.evaluate(`(async () => {
    try {
      const res = await fetch(${JSON.stringify(API)} + ${JSON.stringify(String(uid))}, { credentials: 'include' });
      const j = await res.json();
      const d = j.data || {};
      if (!d.id) return null;
      let fi = {};
      try { fi = typeof d.follow_info === 'string' ? JSON.parse(d.follow_info) : (d.follow_info || {}); } catch (e) {}
      return {
        uid: String(d.id || ''),
        nickname: d.nickname || '',
        gender: Number(d.gender || 0),
        city: d.city || d.location_city || '',
        signature: d.signature || '',
        followers: Number(fi.follower_count || 0),
        following: Number(fi.following_count || 0),
        douyin_id: d.display_id || '',
        sec_uid: d.sec_uid || '',
        age_range: d.age_range || '',
      };
    } catch (e) { return null; }
  })()`);
  return r || null;
}

/**
 * 补全指定评论的评论者资料
 * @param cdp  浏览器 CDP
 * @param opts { limit, onlyMissing, account_id }
 */
export async function enrichComments(cdp, opts = {}) {
  const limit = Number(opts.limit || 100);
  const onlyMissing = opts.onlyMissing !== false;

  const sql = onlyMissing
    ? `SELECT id, user_uid, user_name FROM comments WHERE user_uid IS NOT NULL AND user_uid <> '' AND (user_city = '' OR user_city IS NULL) GROUP BY user_uid LIMIT ?`
    : `SELECT id, user_uid, user_name FROM comments WHERE user_uid IS NOT NULL AND user_uid <> '' GROUP BY user_uid LIMIT ?`;

  const rows = db.getDb().prepare(sql).all(limit);
  logger.info('enrich', `待补全 ${rows.length} 个评论者`);

  const upd = db.getDb().prepare(`UPDATE comments SET
      user_gender = ?, user_city = ?, user_signature = ?, user_followers = ?, user_following = ?,
      user_douyin_id = ?, user_sec_uid = COALESCE(NULLIF(?, ''), user_sec_uid)
    WHERE user_uid = ?`);

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    const p = await one(cdp, row.user_uid);
    if (!p) { fail++; continue; }
    try {
      upd.run(p.gender, p.city, p.signature, p.followers, p.following, p.douyin_id, p.sec_uid, row.user_uid);
      ok++;
    } catch (e) {
      fail++;
      logger.warn('enrich', `${row.user_uid} 写库失败: ${e.message}`);
    }
    await sleep(randInt(400, 900));
  }
  logger.ok('enrich', `补全完成：成功 ${ok} / 失败 ${fail}`);
  return { ok, fail, total: rows.length };
}

/** 从数据库读一个已完成登录的账号对应的 CDP（外部注入） */
export function makeEnricher(cdp) {
  return (opts) => enrichComments(cdp, opts);
}
