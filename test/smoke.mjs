/** 新功能冒烟：定时任务 / 直播 / 会话 / 指纹 / FTS / 导出 */
const base = 'http://127.0.0.1:9527';
const j = async (p, o = {}) => {
  const r = await fetch(base + p, { headers: { 'content-type': 'application/json' }, ...o, body: o.body ? JSON.stringify(o.body) : undefined });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t.slice(0, 200); }
};
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);

// 0. 基础
const stats = await j('/api/stats');
ok('stats', stats.ok === true, JSON.stringify(stats.data?.license?.machine || ''));

// 1. 建账号（拿 id 给后面用）
const accName = '冒烟号_' + Date.now();
const acc = await j('/api/accounts', { method: 'POST', body: { name: accName } });
ok('create account', acc.ok === true, 'id=' + acc.data?.id);
const accId = acc.data?.id;

// 2. 指纹
const fp = await j(`/api/accounts/${accId}/fingerprint`, { method: 'POST' });
ok('fingerprint', fp.ok && !!fp.data?.ua, fp.data?.timezone + ' ' + (fp.data?.ua || '').match(/Chrome\/[\d.]+/)?.[0]);

// 3. 代理设置
const px = await j(`/api/accounts/${accId}/proxy`, { method: 'POST', body: { proxy: 'http://127.0.0.1:8899' } });
ok('account proxy', px.ok && px.data?.proxy === 'http://127.0.0.1:8899');
await j(`/api/accounts/${accId}/proxy`, { method: 'POST', body: { proxy: '' } });

// 4. 定时任务
const sc = await j('/api/schedules', { method: 'POST', body: { name: '冒烟定时', type: 'search_video', params: { keyword: '测试' }, interval_min: 30, account_ids: [accId] } });
ok('create schedule', sc.ok === true, 'id=' + sc.data?.id);
const scList = await j('/api/schedules');
ok('list schedules', Array.isArray(scList.data) && scList.data.length >= 1);
const scOff = await j(`/api/schedules/${sc.data.id}`, { method: 'POST', body: { enabled: false } });
ok('disable schedule', scOff.ok && scOff.data?.enabled === 0);
const scRun = await j(`/api/schedules/${sc.data.id}`, { method: 'POST', body: { run_now: true } });
ok('run schedule now', scRun.ok && !!scRun.data?.triggered, 'task=' + scRun.data?.triggered);

// 5. 直播列表 / 消息
const liveList = await j('/api/live');
ok('live list', liveList.ok && Array.isArray(liveList.data));
const liveMsgs = await j('/api/live/messages?limit=5');
ok('live messages', liveMsgs.ok && Array.isArray(liveMsgs.data));

// 6. 会话数据（空表也要能查）
const conv = await j('/api/data/conversations?limit=5');
ok('data conversations', conv.ok && Array.isArray(conv.data));
const liveData = await j('/api/data/lives?limit=5');
ok('data lives', liveData.ok && Array.isArray(liveData.data));

// 7. FTS 全文检索（塞一条数据再搜）
try {
  const { initDb, upsertItem } = await import('../src/db.js');
  const { loadConfig } = await import('../src/util.js');
  const cfg = loadConfig(process.cwd());
  initDb(cfg);
  upsertItem({ account_id: accId, task_id: 0, keyword: '冒烟关键词', aweme_id: 'smoke_' + Date.now(), desc: '这家麻辣香锅真的绝了', author: '冒烟作者', digg: 1 });
} catch (e) { console.log('seed fail', e.message); }
const fts = await j('/api/data/items?keyword=' + encodeURIComponent('香锅'));
ok('FTS search', fts.ok && fts.total >= 1, 'total=' + fts.total);
const fts2 = await j('/api/data/items?keyword=' + encodeURIComponent('冒烟作者'));
ok('FTS search by author', fts2.ok && fts2.total >= 1, 'total=' + fts2.total);

// 8. 导出（带时间范围）
const to = Date.now() + 86400000;
const from = Date.now() - 86400000;
const xr = await fetch(`${base}/api/export?kind=items&format=xlsx&from=${from}&to=${to}`);
const buf = Buffer.from(await xr.arrayBuffer());
ok('export xlsx', xr.ok && buf[0] === 0x50 && buf[1] === 0x4b, `${buf.length}B`);
const cr = await fetch(`${base}/api/export?kind=conversations&format=csv`);
const csv = await cr.text();
ok('export conversations csv', cr.ok && csv.includes('会话ID'), `${csv.length}B`);

// 9. 任务类型 live_stream 能被识别（入队后因 web_rid 缺失失败也说明路由通了）
const t = await j('/api/tasks', { method: 'POST', body: { type: 'live_stream', params: { minutes: 1 }, account_id: accId } });
ok('enqueue live_stream', t.ok === true, 'task=' + t.data?.id);

// 清理
await j(`/api/schedules/${sc.data.id}`, { method: 'DELETE' });
await j(`/api/accounts/${accId}`, { method: 'DELETE' });
console.log('cleanup done');
