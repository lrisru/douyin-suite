/**
 * 定时调度器：到点触发、next_run 前进、停用不触发、失败延后重试。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  initDb, createAccount, updateAccount, createSchedule, updateSchedule, getSchedule,
  listTasks, listSchedules, getDb,
} from '../src/db.js';
import { TaskEngine } from '../src/tasks.js';
import { Scheduler } from '../src/scheduler.js';
import { loadConfig } from '../src/util.js';

const tmpDir = path.resolve('test/.tmp-scheduler');
fs.rmSync(tmpDir, { recursive: true, force: true });
const cfg = loadConfig(process.cwd());
cfg.dataDir = tmpDir;
cfg.task.concurrency = 2;
initDb(cfg);

const acc = createAccount({ name: 'S1', profile_dir: tmpDir + '/s1', cdp_port: 9601 });
updateAccount(acc.id, { logged_in: 1 });

let calls = 0;
const fake = {
  search: async () => { calls++; return { items: [{ aweme_id: 's' + calls, desc: 'x' }] }; },
};
const engine = new TaskEngine({ douyin: fake, config: cfg, liveManager: null });
engine.start();
const scheduler = new Scheduler({ engine, config: cfg });

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

// 1. 到点触发
const s1 = createSchedule({ name: '每分钟', type: 'search_video', params: { keyword: 'k' }, account_ids: String(acc.id), interval_min: 1 });
updateSchedule(s1.id, { next_run: Date.now() - 1000 });
const before = listTasks(100).length;
scheduler.tick();
await new Promise((r) => setTimeout(r, 600));
const after = listTasks(100);
const s1b = getSchedule(s1.id);
check('到点触发任务', after.length === before + 1, `${before} -> ${after.length}`);
check('记录 last_task_id', s1b.last_task_id > 0, String(s1b.last_task_id));
check('next_run 前进', s1b.next_run > Date.now(), new Date(s1b.next_run).toLocaleTimeString());
check('last_run 已写', s1b.last_run > 0);

// 2. 未到点不触发
const s2 = createSchedule({ name: '未来', type: 'search_video', params: { keyword: 'k2' }, account_ids: String(acc.id), interval_min: 60 });
updateSchedule(s2.id, { next_run: Date.now() + 60000 });
const before2 = listTasks(100).length;
scheduler.tick();
await new Promise((r) => setTimeout(r, 300));
check('未到点不触发', listTasks(100).length === before2);

// 3. 停用不触发
updateSchedule(s2.id, { enabled: 0, next_run: Date.now() - 1000 });
const before3 = listTasks(100).length;
scheduler.tick();
await new Promise((r) => setTimeout(r, 300));
check('停用不触发', listTasks(100).length === before3);

// 4. 多账号列表透传
fake.search = async (a, p) => { calls++; return { items: [] }; };
const s3 = createSchedule({ name: '多账号', type: 'search_video', params: { keyword: 'k3' }, account_ids: `${acc.id},${acc.id}`, interval_min: 5 });
updateSchedule(s3.id, { next_run: Date.now() - 1000 });
scheduler.tick();
await new Promise((r) => setTimeout(r, 400));
const t3 = listTasks(5)[0];
const p3 = JSON.parse(t3.params || '{}');
check('账号列表透传', JSON.stringify(p3.account_ids) === JSON.stringify([acc.id, acc.id]), JSON.stringify(p3));

// 5. 坏配置的任务：解析 params 失败也要继续跑其他任务
const s4 = createSchedule({ name: '坏参数', type: 'search_video', params: {}, account_ids: String(acc.id), interval_min: 5 });
getDb().prepare('UPDATE schedules SET params = ? WHERE id = ?').run('{bad json', s4.id);
updateSchedule(s4.id, { next_run: Date.now() - 1000 });
let threw = false;
try { scheduler.tick(); } catch { threw = true; }
check('坏 params 不炸 tick', threw === false);
const s4b = getSchedule(s4.id);
check('坏任务延后重试', s4b.next_run > Date.now() + 4 * 60000, String(s4b.next_run - Date.now()));

// 6. 已触发过的不会重复触发（next_run 已推进）
const before6 = listTasks(100).length;
scheduler.tick();
await new Promise((r) => setTimeout(r, 300));
check('不重复触发', listTasks(100).length === before6);

scheduler.stop();
engine.stop();

console.log(`\n${pass} pass, ${fail} fail`);
try { getDb().close(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 300));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
