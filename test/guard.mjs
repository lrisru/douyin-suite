/**
 * 页面健康检查：验证码页 / 重定向验证页 / 空白页 要给出明确错误，不能静默 0 条。
 */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { DouyinService } from '../src/douyin.js';
import { loadConfig } from '../src/util.js';

const PORT = 9374;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (u.pathname === '/captcha') return res.end('<title>验证码中间页</title><body>请完成验证</body>');
  if (u.pathname === '/verify') return res.end('<title>正常标题</title><body>ok</body>');
  if (u.pathname === '/empty') return res.end('<title></title><body></body>');
  return res.end('<title>正常页面</title><body>有内容</body>');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(os.tmpdir(), 'dy-guard-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port: 9375, headless: true, width: 900, height: 700 });
const ep = await waitEndpoint(9375, 20000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(9375, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();

const cfg = loadConfig(process.cwd());
const host = { page: async () => ({ cdp }), checkLogin: async () => ({ loggedIn: true }) };
const douyin = new DouyinService(host, cfg);
const acc = { id: 1 };

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

async function capture(name, pathname) {
  try {
    await douyin.capturePage(acc, `http://127.0.0.1:${PORT}${pathname}`, [/never-match/], { scrolls: 0, settleMs: 350 });
    return { threw: false, msg: '' };
  } catch (e) {
    return { threw: true, msg: e.message };
  }
}

const captcha = await capture('captcha', '/captcha');
check('验证码页报错', captcha.threw && /验证码/.test(captcha.msg), captcha.msg);

const verify = await capture('verify', '/verify?next=/home');
check('重定向验证页报错', verify.threw && /验证页/.test(verify.msg), verify.msg);

const empty = await capture('empty', '/empty');
check('空白页报错', empty.threw && /空白/.test(empty.msg), empty.msg);

const normal = await capture('normal', '/normal');
check('正常页面不报错', normal.threw === false, normal.msg);

console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
await new Promise((r) => setTimeout(r, 300));
try { process.kill(chrome.pid); } catch { /* ignore */ }
server.close();
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
