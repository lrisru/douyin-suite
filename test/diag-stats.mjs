/** 诊断：搜索结果的 statistics 里到底有哪些计数 */
import { loadConfig } from '../src/util.js';
import * as db from '../src/db.js';

db.initDb(loadConfig(process.cwd()));
const rows = db.getDb().prepare("SELECT aweme_id, desc, digg, comment_count, collect_count, share_count, play_count, raw FROM items WHERE raw IS NOT NULL LIMIT 3").all();

for (const r of rows) {
  console.log('\n作品:', (r.desc || '').slice(0, 24));
  console.log('  库里: 点赞', r.digg, '| 评论', r.comment_count, '| 收藏', r.collect_count, '| 分享', r.share_count, '| 播放', r.play_count);
  let raw = {};
  try { raw = JSON.parse(r.raw); } catch { /* ignore */ }
  const st = raw.statistics || raw.stats || {};
  console.log('  raw.statistics:', JSON.stringify(st).slice(0, 300));
  const keys = Object.keys(raw).filter((k) => /stat|count/i.test(k));
  console.log('  raw 里含 count/stat 的字段:', keys.join(',') || '(无)');
}

const sum = db.getDb().prepare('SELECT SUM(comment_count) c, SUM(collect_count) co, SUM(share_count) s, SUM(digg) d, COUNT(*) n FROM items').get();
console.log('\n全库汇总:', JSON.stringify(sum));
