/**
 * 多账号轮转：不指定账号时按在线账号轮询；指定 account_ids 时按池轮换。
 * 用临时 dataDir，不碰正式库。
 */
import fs from 'node:fs';
import path from 'node:path';
import { initDb, createAccount, updateAccount, listAccounts } from '../src/db.js';
import { TaskEngine } from '../src/tasks.js';
import { loadConfig } from '../src/util.js';

const tmpDir = path.resolve('test/.tmp-rotation');
fs.rmSync(tmpDir, { recursive: true, force: true });

const cfg = loadConfig(process.cwd());
cfg.dataDir = tmpDir;
initDb(cfg);

const a1 = createAccount({ name: 'A', profile_dir: tmpDir + '/a', cdp_port: 9401 });
const a2 = createAccount({ name: 'B', profile_dir: tmpDir + '/b', cdp_port: 9402 });
const a3 = createAccount({ name: 'C', profile_dir: tmpDir + '/c', cdp_port: 9403 });
for (const a of [a1, a2, a3]) updateAccount(a.id, { logged_in: 1 });

const engine = new TaskEngine({ douyin: null, config: cfg, liveManager: null });

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

// 1. 全局轮转（不指定账号）
const seq = [];
for (let i = 0; i < 6; i++) seq.push(engine.resolveAccount({ account_id: null }, {}).id);
check('轮转顺序', JSON.stringify(seq) === JSON.stringify([a1.id, a2.id, a3.id, a1.id, a2.id, a3.id]), JSON.stringify(seq));

// 2. 指定账号优先
const picked = engine.resolveAccount({ account_id: a2.id }, {});
check('指定账号优先', picked.id === a2.id, picked.name);

// 3. account_ids 池轮换
const pool = engine.accountPool({ account_ids: [a1.id, a3.id] });
check('账号池构建', pool?.length === 2, JSON.stringify(pool?.map((x) => x.name)));
const at = [0, 1, 2, 3].map((i) => engine.accountAt(pool, i, null).name);
check('池内轮换', JSON.stringify(at) === JSON.stringify(['A', 'C', 'A', 'C']), JSON.stringify(at));

// 4. 单个池成员不触发轮换
const single = engine.accountPool({ account_ids: [a1.id] });
check('单账号不建池', single === null);

// 5. 无在线账号时回落到任意账号
updateAccount(a1.id, { logged_in: 0 });
updateAccount(a2.id, { logged_in: 0 });
updateAccount(a3.id, { logged_in: 0 });
const any = engine.resolveAccount({ account_id: null }, {});
check('无在线时回落', !!any?.id, any?.name);

// 6. 完全没有账号时抛错
const { getDb } = await import('../src/db.js');
getDb().exec('DELETE FROM accounts');
let threw = false;
try { engine.resolveAccount({ account_id: null }, {}); } catch { threw = true; }
check('无账号时报错', threw);

console.log(`\n${pass} pass, ${fail} fail`);
try { getDb().close(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 300));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 句柄未释放时留待下次 */ }
process.exit(fail ? 1 : 0);
