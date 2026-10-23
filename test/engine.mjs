/**
 * 任务引擎生命周期：入队 → 执行 → 计数 → 入库 → 状态回写 → 失败处理。
 * 用假 douyin 服务，不依赖浏览器与登录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { initDb, createAccount, updateAccount, listTasks, queryRows, getDb } from '../src/db.js';
import { TaskEngine } from '../src/tasks.js';
import { loadConfig } from '../src/util.js';

const tmpDir = path.resolve('test/.tmp-engine');
fs.rmSync(tmpDir, { recursive: true, force: true });

const cfg = loadConfig(process.cwd());
cfg.dataDir = tmpDir;
cfg.task.concurrency = 1;
cfg.task.minDelayMs = 10;
cfg.task.maxDelayMs = 20;
initDb(cfg);

const acc = createAccount({ name: 'E1', profile_dir: tmpDir + '/e1', cdp_port: 9501 });
updateAccount(acc.id, { logged_in: 1 });

const calls = [];
const fake = {
  followers: async () => { calls.push('followers'); return { users: [{ sec_uid: 'u1', nickname: 'A', follower_count: 1 }, { sec_uid: 'u2', nickname: 'B' }] }; },
  search: async (a, p) => { calls.push('search'); return { items: [{ aweme_id: 'a1', desc: 'd1', digg: 5 }, { aweme_id: 'a2', desc: 'd2' }] }; },
  comments: async () => { calls.push('comments'); return { comments: [{ cid: 'c1', text: 't1' }] }; },
  like: async () => { calls.push('like'); return { ok: true, changed: true, state: 'is-digged' }; },
  conversations: async () => { calls.push('conv'); return { conversations: [{ conversation_id: 'cv1', nickname: 'N' }] }; },
  live: async () => { calls.push('live'); return { web_rid: '123', title: '直播', anchor: '主播', online: 9 }; },
  download: async () => { calls.push('dl'); return { dir: tmpDir, results: [{ ok: true, aweme_id: 'a1', files: [{ file: 'x.mp4', size: 10 }] }] }; },
  failing: async () => { throw new Error('模拟接口失败'); },
};

const engine = new TaskEngine({ douyin: fake, config: cfg, liveManager: null });
engine.start();

const ids = [];
ids.push(engine.enqueue('followers', { sec_uid: 'x' }, acc.id).id);
ids.push(engine.enqueue('search_video', { keyword: '测试' }, acc.id).id);
ids.push(engine.enqueue('comments', { aweme_ids: ['a1'] }, acc.id).id);
ids.push(engine.enqueue('like', { aweme_ids: ['a1', 'a2'] }, acc.id).id);
ids.push(engine.enqueue('conversations', {}, acc.id).id);
ids.push(engine.enqueue('live', { web_rid: '123' }, acc.id).id);
ids.push(engine.enqueue('download', { aweme_ids: ['a1'] }, acc.id).id);

const waitFor = async (wantedIds, ms = 20000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const tasks = listTasks(50).filter((t) => wantedIds.includes(t.id));
    if (tasks.length === wantedIds.length && tasks.every((t) => t.status === 'done' || t.status === 'failed')) return tasks;
    await new Promise((r) => setTimeout(r, 150));
  }
  return listTasks(50).filter((t) => wantedIds.includes(t.id));
};

// 等前 7 个任务跑完，再把 comments 换成会抛错的版本，保证失败用例干净
await waitFor(ids);
fake.comments = async () => { throw new Error('模拟接口失败'); };
const failTask = engine.enqueue('comments', { aweme_ids: ['boom'] }, acc.id);

const allIds = [...ids, failTask.id];
await waitFor(allIds);
engine.stop();

const tasks = listTasks(50).filter((t) => allIds.includes(t.id));
const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

check('全部任务结束', tasks.every((t) => t.status === 'done' || t.status === 'failed'), JSON.stringify(tasks.map((t) => t.status)));
check('followers 成功', byId[ids[0]].status === 'done' && byId[ids[0]].done === 2, `done=${byId[ids[0]].done}`);
check('search 成功', byId[ids[1]].status === 'done' && byId[ids[1]].done === 2);
check('comments 成功', byId[ids[2]].status === 'done' && byId[ids[2]].done === 1);
check('like 计数', byId[ids[3]].status === 'done' && byId[ids[3]].done === 2);
check('conversations 成功', byId[ids[4]].status === 'done' && byId[ids[4]].done === 1);
check('live 成功', byId[ids[5]].status === 'done' && byId[ids[5]].done === 1);
check('download 成功', byId[ids[6]].status === 'done' && byId[ids[6]].done === 1);
check('失败任务标记', byId[failTask.id].status === 'failed' && byId[failTask.id].failed === 1, `status=${byId[failTask.id].status} failed=${byId[failTask.id].failed}`);

const users = queryRows('users', { limit: 100 });
const items = queryRows('items', { limit: 100 });
const comments = queryRows('comments', { limit: 100 });
const convs = queryRows('conversations', { limit: 100 });
const lives = queryRows('lives', { limit: 100 });
check('用户入库', users.length === 2, users.map((u) => u.nickname).join(','));
check('作品入库', items.length === 2);
check('评论入库', comments.length === 1, comments[0]?.text);
check('会话入库', convs.length === 1);
check('直播入库', lives.length === 1);

// 任务耗时与时间戳
const t0 = byId[ids[0]];
check('时间戳完整', !!t0.started_at && !!t0.finished_at && t0.finished_at >= t0.started_at);

console.log(`\n${pass} pass, ${fail} fail`);
try { getDb().close(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 300));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
