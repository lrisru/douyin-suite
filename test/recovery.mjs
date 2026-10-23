/**
 * 浏览器崩溃自恢复：杀掉 Chrome 进程后，下一次取页面应自动重启并恢复可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { BrowserHost } from '../src/browser.js';
import { initDb, createAccount, updateAccount, getDb } from '../src/db.js';
import { loadConfig } from '../src/util.js';

const tmpDir = path.resolve('test/.tmp-recovery');
fs.rmSync(tmpDir, { recursive: true, force: true });
const cfg = loadConfig(process.cwd());
cfg.dataDir = tmpDir;
cfg.headless = true;
initDb(cfg);

const acc = createAccount({ name: 'Rec', profile_dir: path.join(tmpDir, 'profiles', 'rec'), cdp_port: 9711 });
updateAccount(acc.id, { logged_in: 1 });

const host = new BrowserHost(cfg);
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

const t0 = Date.now();
const s1 = await host.ensure(acc);
const ok1 = await s1.cdp ? false : true;
check('首次启动浏览器', !!s1.proc, `port=${s1.port} ${Date.now() - t0}ms`);

const { cdp } = await host.page(acc, 'data:text/html,<title>rec</title>');
const ping1 = await cdp.evaluate('1+1');
check('连接可用', ping1 === 2, String(ping1));

// 强杀整个进程树
const pid = s1.proc?.pid;
await new Promise((resolve) => {
  execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }, () => resolve());
});
await new Promise((r) => setTimeout(r, 1500));

const alive = await host.isAlive(s1.port);
check('进程已被杀掉', alive === false, `port ${s1.port} alive=${alive}`);

// 再次取页面应自动重启
const t1 = Date.now();
let restarted = null;
let err = '';
try {
  restarted = await host.page(acc, 'data:text/html,<title>rec2</title>');
} catch (e) {
  err = e.message;
}
const took = Date.now() - t1;
check('自动重启成功', !!restarted, err || `${took}ms`);

if (restarted) {
  const ping2 = await restarted.cdp.evaluate('document.title');
  check('重启后页面可用', ping2 === 'rec2', String(ping2));
  check('重启后端口一致', (await host.isAlive(s1.port)) === true, String(s1.port));
  check('重启耗时合理(<30s)', took < 30000, `${took}ms`);
}

await host.shutdown();
console.log(`\n${pass} pass, ${fail} fail`);
try { getDb().close(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
