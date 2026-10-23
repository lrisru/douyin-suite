/**
 * 多开隔离：两个独立 profile 的浏览器，Cookie 与 localStorage 互不可见。
 */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const PORT = 9366;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname === '/set') {
    const name = u.searchParams.get('name') || 'x';
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': [`probe=${name}; Path=/; Max-Age=3600`],
    });
    return res.end(`<title>set ${name}</title><body>ok</body>`);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<title>home</title><body>home</body>');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const chromePath = findChrome({});
const dirs = [];
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

async function openProfile(tag, port) {
  const dir = path.join(os.tmpdir(), `dy-iso-${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  const proc = launchChrome({ chromePath, profileDir: dir, port, headless: true, width: 900, height: 700 });
  const ep = await waitEndpoint(port, 20000);
  if (!ep) throw new Error('chrome not ready ' + tag);
  const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
  await cdp.enable();
  return { proc, cdp, dir };
}

const A = await openProfile('a', 9370);
const B = await openProfile('b', 9371);

// A 写 cookie + localStorage
await A.cdp.navigate(`http://127.0.0.1:${PORT}/set?name=alpha`, { waitMs: 800 });
await A.cdp.evaluate(`localStorage.setItem('who', 'alpha')`);
const aCookies = await A.cdp.getCookies([`http://127.0.0.1:${PORT}`]);

// B 打开同一站点
await B.cdp.navigate(`http://127.0.0.1:${PORT}/`, { waitMs: 800 });
const bCookies = await B.cdp.getCookies([`http://127.0.0.1:${PORT}`]);
const bLocal = await B.cdp.evaluate(`localStorage.getItem('who')`);
const bTitle = await B.cdp.evaluate('document.title');

check('A 写入 Cookie', aCookies.some((c) => c.name === 'probe' && c.value === 'alpha'), JSON.stringify(aCookies.map((c) => c.name)));
check('B 看不到 A 的 Cookie', !bCookies.some((c) => c.name === 'probe'), JSON.stringify(bCookies.map((c) => c.name)));
check('B 看不到 A 的 localStorage', bLocal === null, String(bLocal));
check('B 页面正常加载', bTitle === 'home', bTitle);

// A 重新打开，自己数据还在
await A.cdp.navigate(`http://127.0.0.1:${PORT}/`, { waitMs: 600 });
const aLocal = await A.cdp.evaluate(`localStorage.getItem('who')`);
const aCookies2 = await A.cdp.getCookies([`http://127.0.0.1:${PORT}`]);
check('A 重开后 localStorage 保留', aLocal === 'alpha', String(aLocal));
check('A 重开后 Cookie 保留', aCookies2.some((c) => c.name === 'probe'), '');

// B 自己写，不污染 A
await B.cdp.navigate(`http://127.0.0.1:${PORT}/set?name=beta`, { waitMs: 800 });
const aAfter = await A.cdp.getCookies([`http://127.0.0.1:${PORT}`]);
const aProbe = aAfter.find((c) => c.name === 'probe');
check('B 写入不影响 A', aProbe?.value === 'alpha', aProbe?.value);

console.log(`\n${pass} pass, ${fail} fail`);
A.cdp.close();
B.cdp.close();
await new Promise((r) => setTimeout(r, 300));
try { A.proc.kill(); } catch { /* ignore */ }
try { B.proc.kill(); } catch { /* ignore */ }
server.close();
await new Promise((r) => setTimeout(r, 700));
for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
process.exit(fail ? 1 : 0);
