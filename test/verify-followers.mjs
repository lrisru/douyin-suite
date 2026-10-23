/** 真实粉丝/关注列表任务验证 */
const base = 'http://127.0.0.1:9527';
const j = async (p, o = {}) => {
  const r = await fetch(base + p, { headers: { 'content-type': 'application/json' }, ...o, body: o.body ? JSON.stringify(o.body) : undefined });
  return r.json();
};

const SEC = process.argv[2] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380rH-K8B91qq8KTo';
const KIND = process.argv[3] || 'followers';
const LIMIT = Number(process.argv[4] || 60);

const wait = async (id, ms = 120000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const list = await j('/api/tasks?limit=5');
    const t = list.data.find((x) => x.id === id);
    if (t && ['done', 'failed', 'cancelled'].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
};

const t = await j('/api/tasks', { method: 'POST', body: { type: KIND, params: { sec_uid: SEC, limit: LIMIT }, account_id: 9 } });
console.log('task', t.data?.id, KIND, 'limit', LIMIT);
const r = await wait(t.data.id);
console.log('结果:', JSON.stringify({ status: r?.status, done: r?.done, failed: r?.failed, error: r?.error }));

const users = await j('/api/data/users?limit=10');
console.log('用户表:', users.total, '条');
for (const u of (users.data || []).slice(0, 6)) {
  console.log(`  ${u.nickname} | ${u.unique_id} | 粉丝 ${u.follower_count} | ${u.sec_uid.slice(0, 20)}…`);
}
