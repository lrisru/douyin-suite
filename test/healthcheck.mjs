/**
 * 全面自检：逐个调用 API 与任务，输出通过/失败矩阵。
 */
const BASE = 'http://127.0.0.1:9527';
const results = [];
const add = (scope, name, ok, detail = '') => {
  results.push({ scope, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scope}] ${name}${detail ? '  ' + detail : ''}`);
};

const j = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body = null;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 120) }; }
  return { status: r.status, body };
};

/* ---------- 1. 基础 API ---------- */
{
  const s = await j('/api/stats');
  add('api', 'stats', s.status === 200 && s.body.ok, `items=${s.body?.data?.items} users=${s.body?.data?.users}`);
  const a = await j('/api/accounts');
  add('api', 'accounts', a.status === 200, `count=${a.body?.data?.length}`);
  const t = await j('/api/tasks?limit=5');
  add('api', 'tasks', t.status === 200, `count=${t.body?.data?.length}`);
  const l = await j('/api/logs?limit=5');
  add('api', 'logs', l.status === 200, `count=${l.body?.data?.length}`);
  const lg = await j('/api/license');
  add('api', 'license', lg.status === 200, lg.body?.data?.machine || '');
  const st = await j('/api/settings');
  add('api', 'settings', st.status === 200, `chrome=${!!st.body?.data?.chrome}`);
  const p = await j('/api/proxies');
  add('api', 'proxies', p.status === 200, `count=${p.body?.data?.length}`);
  const lv = await j('/api/live');
  add('api', 'live list', lv.status === 200, `sessions=${lv.body?.data?.length}`);
  const sc = await j('/api/schedules');
  add('api', 'schedules', sc.status === 200, `count=${sc.body?.data?.length}`);
}

/* ---------- 2. 数据查询（5 种 + 关键词 + 日期） ---------- */
{
  const from = new Date('2026-01-01T00:00:00').getTime();
  const to = Date.now();
  for (const kind of ['items', 'users', 'comments', 'lives', 'conversations']) {
    const r = await j(`/api/data/${kind}?limit=3`);
    add('data', kind, r.status === 200 && r.body.ok, `total=${r.body?.total}`);
    const r2 = await j(`/api/data/${kind}?limit=3&from=${from}&to=${to}`);
    add('data', kind + ' 日期', r2.status === 200, `total=${r2.body?.total}`);
  }
}

/* ---------- 3. 导出 ---------- */
{
  for (const kind of ['items', 'users', 'comments', 'lives', 'conversations']) {
    for (const fmt of ['xlsx', 'csv']) {
      const r = await fetch(`${BASE}/api/export?kind=${kind}&format=${fmt}`);
      const buf = Buffer.from(await r.arrayBuffer());
      add('export', `${kind}.${fmt}`, r.ok && buf.length > 0, `${buf.length}B`);
    }
  }
}

/* ---------- 4. 分享链接解析 ---------- */
{
  const r = await j('/api/parse', { method: 'POST', body: { url: 'https://www.douyin.com/video/7532780281573510446' } });
  add('api', 'parse share', r.status === 200, JSON.stringify(r.body?.data?.ok));
}

/* ---------- 5. 真实任务 ---------- */
const waitTask = async (id, ms = 120000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const l = await j('/api/tasks?limit=6');
    const t = l.body?.data?.find((x) => x.id === id);
    if (t && ['done', 'failed', 'cancelled'].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
};

const runTask = async (type, params, label) => {
  const created = await j('/api/tasks', { method: 'POST', body: { type, params, account_id: 9 } });
  if (!created.body?.ok) { add('task', label || type, false, created.body?.error || 'enqueue failed'); return null; }
  const t = await waitTask(created.body.data.id);
  const ok = t && t.status === 'done' && (t.done > 0 || type === 'parse_share');
  add('task', label || type, !!ok, `status=${t?.status} done=${t?.done} err=${(t?.error || '').slice(0, 60)}`);
  return t;
};

await runTask('search_video', { keyword: '贴膜', limit: 10 }, 'search_video');
await runTask('search_user', { keyword: '贴膜', limit: 10 }, 'search_user');
await runTask('search_live', { keyword: '直播带货', limit: 10 }, 'search_live');

/* ---------- 6. 用已有数据跑下游任务 ---------- */
{
  const items = await j('/api/data/items?limit=3');
  const aweme = items.body?.data?.[0]?.aweme_id;
  const users = await j('/api/data/users?limit=3');
  const sec = users.body?.data?.[0]?.sec_uid;

  if (aweme) {
    await runTask('comments', { aweme_ids: [aweme], limit: 20 }, 'comments');
    await runTask('download', { aweme_ids: [aweme] }, 'download');
  } else {
    add('task', 'comments', false, '没有作品 ID 可用');
  }
  if (sec) {
    await runTask('user_profile', { sec_uid: sec }, 'user_profile');
    await runTask('user_works', { sec_uid: sec, limit: 10 }, 'user_works');
  } else {
    add('task', 'user_profile', false, '没有 sec_uid 可用');
  }
  // 粉丝列表用固定主播（有公开粉丝），随机用户大多把粉丝设成私密
  const KNOWN_SEC = 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380rH-K8B91qq8KTo';
  await runTask('followers', { sec_uid: KNOWN_SEC, limit: 20 }, 'followers');
}

/* ---------- 7. 定时任务 ---------- */
{
  const c = await j('/api/schedules', { method: 'POST', body: { name: '自检', type: 'search_video', params: { keyword: '自检' }, interval_min: 60, account_ids: [9] } });
  add('schedule', 'create', c.body?.ok === true, 'id=' + c.body?.data?.id);
  if (c.body?.data?.id) {
    const run = await j(`/api/schedules/${c.body.data.id}`, { method: 'POST', body: { run_now: true } });
    add('schedule', 'run_now', run.body?.ok === true, 'task=' + run.body?.data?.triggered);
    const off = await j(`/api/schedules/${c.body.data.id}`, { method: 'POST', body: { enabled: false } });
    add('schedule', 'disable', off.body?.data?.enabled === 0);
    const del = await j(`/api/schedules/${c.body.data.id}`, { method: 'DELETE' });
    add('schedule', 'delete', del.body?.ok === true);
  }
}

/* ---------- 汇总 ---------- */
const failed = results.filter((r) => !r.ok);
console.log(`\n===== 通过 ${results.length - failed.length} / ${results.length} =====`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log(` - [${f.scope}] ${f.name}  ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);
