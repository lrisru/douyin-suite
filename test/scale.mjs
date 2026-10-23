/**
 * 数据量测试：5000 条作品写入（含 FTS 同步）、检索、分页、导出。
 * 用来判断逐条 upsert + FTS 重建是否有性能问题。
 */
import fs from 'node:fs';
import path from 'node:path';
import { initDb, upsertItem, queryRows, countRows, getDb } from '../src/db.js';
import { toXlsx, toCsv, EXPORT_SCHEMAS } from '../src/export.js';
import { loadConfig } from '../src/util.js';

const tmpDir = path.resolve('test/.tmp-scale');
fs.rmSync(tmpDir, { recursive: true, force: true });
const cfg = loadConfig(process.cwd());
cfg.dataDir = tmpDir;
initDb(cfg);

const N = 5000;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  upsertItem({
    account_id: 1, task_id: 1,
    keyword: i % 2 ? '美食' : '旅行',
    aweme_id: `scale_${i}`,
    desc: `第 ${i} 条作品 麻辣香锅 ${i % 7 === 0 ? '火锅' : '教程'}`,
    author: `作者${i % 50}`,
    digg: i, comment: i % 100, collect: i % 30, share: i % 10,
    create_time: 1792000000 + i,
    url: `https://www.douyin.com/video/scale_${i}`,
  });
}
const tInsert = Date.now() - t0;

const t1 = Date.now();
const hit = queryRows('items', { keyword: '火锅', limit: 10 });
const tSearch = Date.now() - t1;

const t2 = Date.now();
const authorHit = queryRows('items', { keyword: '作者7', limit: 10 });
const tSearch2 = Date.now() - t2;

const t3 = Date.now();
const page = queryRows('items', { limit: 100, offset: 4900 });
const tPage = Date.now() - t3;

const t4 = Date.now();
const rows = queryRows('items', { limit: 200000 });
const buf = toXlsx(EXPORT_SCHEMAS.items.columns, rows, '作品');
const tXlsx = Date.now() - t4;

const csv = toCsv('items', rows.slice(0, 1000));

const total = countRows('items');
const ftsRows = getDb().prepare('SELECT COUNT(*) c FROM items_fts').get().c;

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

console.log(`写入 ${N} 条: ${tInsert}ms (${(tInsert / N).toFixed(2)}ms/条)`);
console.log(`FTS 检索「火锅」: ${tSearch}ms 命中 ${hit.length}`);
console.log(`FTS 检索「作者7」: ${tSearch2}ms 命中 ${authorHit.length}`);
console.log(`分页 offset=4900: ${tPage}ms 返回 ${page.length}`);
console.log(`导出 XLSX ${rows.length} 行: ${tXlsx}ms, ${(buf.length / 1024 / 1024).toFixed(2)}MB`);
console.log(`CSV 1000 行: ${(csv.length / 1024).toFixed(0)}KB`);

check('写入条数正确', total === N, String(total));
check('FTS 索引条数同步', ftsRows === N, String(ftsRows));
check('检索命中火锅', hit.length > 0, String(hit.length));
check('检索命中作者', authorHit.length > 0, String(authorHit.length));
check('分页正确', page.length === 100);
check('XLSX 是 ZIP', buf[0] === 0x50 && buf[1] === 0x4b, `${(buf.length / 1024 / 1024).toFixed(2)}MB`);
check('写入性能可接受(<10ms/条)', tInsert / N < 10, `${(tInsert / N).toFixed(2)}ms/条`);
check('检索性能可接受(<500ms)', tSearch < 500, `${tSearch}ms`);
check('导出耗时(<10s)', tXlsx < 10000, `${tXlsx}ms`);

console.log(`\n${pass} pass, ${fail} fail`);
try { getDb().close(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 300));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
