/** 全量回填评论者资料，然后按城市统计 */
const base = 'http://127.0.0.1:9527';

const j = async (p, o = {}) => {
  const r = await fetch(base + p, { headers: { 'content-type': 'application/json' }, ...o, body: o.body ? JSON.stringify(o.body) : undefined });
  return r.json();
};

let total = 0;
for (let round = 1; round <= 30; round++) {
  const r = await j('/api/enrich', { method: 'POST', body: { limit: 50 } });
  const d = r.data || {};
  if (!d.total) { console.log(`第 ${round} 轮：没有待补全的了`); break; }
  total += d.ok || 0;
  console.log(`第 ${round} 轮：成功 ${d.ok} 失败 ${d.fail}（累计 ${total}）`);
  if ((d.total || 0) < 50) break;
  await new Promise((res) => setTimeout(res, 1000));
}

// 统计
const { loadConfig } = await import('../src/util.js');
const db = await import('../src/db.js');
db.initDb(loadConfig(process.cwd()));
const rows = db.getDb().prepare("SELECT user_city, COUNT(*) n FROM comments WHERE user_city <> '' GROUP BY user_city ORDER BY n DESC").all();
console.log('\n城市分布（前 20）:');
for (const r of rows.slice(0, 20)) console.log(`  ${r.user_city.padEnd(10)} ${r.n}`);
const hz = rows.filter((r) => /杭州/.test(r.user_city));
console.log('\n杭州:', hz.map((r) => `${r.n} 条`).join(',') || '0');
const zj = rows.filter((r) => /杭州|宁波|温州|绍兴|嘉兴|金华|台州|湖州|衢州|丽水|舟山/.test(r.user_city));
console.log('浙江全省:', zj.reduce((a, b) => a + b.n, 0), '条');
process.exit(0);
