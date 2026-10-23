/**
 * 可靠性：任务自动重试 + 取消（排队中 / 运行中）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { initDb, createAccount, updateAccount, listTasks, queryRows, getDb } from '../src/db.js';
import { TaskEngine } from '../src/tasks.js';
import { loadConfig } from '../src/util.js';

const tmpDir = path.resolve('test/.tmp-reliability');
fs.rmSync(tmpDir, { recursive: true, force: true });
const cfg = loadConfig(process.cwd());
cfg.dataDir = tmpDir;
cfg.task.concurrency = 1;
cfg.task.retry = 1;
cfg.task.minDelayMs = 30;
cfg.task.maxDelayMs = 40;
initDb(cfg);

const acc = createAccount({ name: 'R1', profile_dir: tmpDir + '/r1', cdp_port: 9701 });
updateAccount(acc.id, { logged_in: 1 });

let followersCalls = 0;
let likeCalls = 0;
const fake = {
  followers: async () => {
    followersCalls++;
    if (followersCalls === 1) throw new Error('第一次故意失败');
    return { users: [{ sec_uid: 'r1', nickname: '重试成功' }] };
  },
  like: async () => {
    likeCalls++;
    await new Promise((r) => setTimeout(r, 120));
    return { ok: true, changed: true, state: 'is-digged' };
  },
  search: async () => ({ items: [] }),
};

const engine = new TaskEngine({ douyin: fake, config: cfg, liveManager: null });
engine.start();

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};
const waitStatus = async (id, ms = 10000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const t = listTasks(50).find((x) => x.id === id);
    if (t && ['done', 'failed', 'cancelled'].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 120));
  }
  return listTasks(50).find((x) => x.id === id);
};

// 1. 重试：第一次失败，第二次成功
const t1 = engine.enqueue('followers', { sec_uid: 'x' }, acc.id);
const r1 = await waitStatus(t1.id);
check('重试后成功', r1.status === 'done' && followersCalls === 2, `status=${r1.status} calls=${followersCalls}`);
check('重试后入库', queryRows('users', { limit: 10 }).some((u) => u.nickname === '重试成功'));

// 2. 取消排队中的任务：先占住唯一并发槽
const slow = engine.enqueue('like', { aweme_ids: Array.from({ length: 6 }, (_, i) => 'id' + i) }, acc.id);
await new Promise((r) => setTimeout(r, 150));
const queued = engine.enqueue('search_video', { keyword: '排队中' }, acc.id);
const cancelQueued = engine.cancel(queued.id);
const rQueued = await waitStatus(queued.id);
check('排队任务取消', cancelQueued.removed === true && rQueued.status === 'cancelled', `status=${rQueued.status}`);

// 3. 取消运行中的任务
const cancelRunning = engine.cancel(slow.id);
const rSlow = await waitStatus(slow.id, 15000);
check('运行中任务取消', cancelRunning.removed === false && rSlow.status === 'cancelled', `status=${rSlow.status} 已执行=${likeCalls}`);
check('取消后不再继续执行', likeCalls < 6, `likeCalls=${likeCalls}`);

// 4. 取消后再重跑同一 ID 不应被误杀
const t4 = engine.enqueue('followers', { sec_uid: 'y' }, acc.id);
const r4 = await waitStatus(t4.id);
check('新任务不受取消影响', r4.status === 'done', r4.status);

engine.stop();

console.log(`\n${pass} pass, ${fail} fail`);
try { getDb().close(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 300));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
