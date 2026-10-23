/**
 * 代理实际生效验证：给 Chrome 挂本地 HTTP 代理，确认请求真的走代理，
 * 并确认「关掉代理」时不再走。
 */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const PROXY_PORT = 9380;
const seen = [];
const proxy = http.createServer((req, res) => {
  seen.push({ url: req.url, host: req.headers.host });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<title>via-proxy</title><body>proxied</body>');
});
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));

const chromePath = findChrome({});
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

async function openWithProxy(tag, port, proxyUrl) {
  const dir = path.join(os.tmpdir(), `dy-proxy-${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const proc = launchChrome({ chromePath, profileDir: dir, port, headless: true, width: 800, height: 600, proxy: proxyUrl });
  const ep = await waitEndpoint(port, 20000);
  if (!ep) throw new Error('chrome not ready');
  const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
  await cdp.enable();
  let title = '';
  let err = '';
  try {
    await cdp.navigate('http://douyin-suite-proxy-check.invalid/', { waitMs: 1800 });
    title = await cdp.evaluate('document.title');
  } catch (e) { err = e.message; }
  cdp.close();
  await new Promise((r) => setTimeout(r, 250));
  try { proc.kill(); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 500));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { title, err };
}

const withProxy = await openWithProxy('on', 9381, `http://127.0.0.1:${PROXY_PORT}`);
check('挂代理后请求到达代理', withProxy.title === 'via-proxy', withProxy.title || withProxy.err);
check('代理收到请求记录', seen.length > 0, JSON.stringify(seen[0] || {}));

const withoutProxy = await openWithProxy('off', 9382, undefined);
check('不挂代理时不经过代理', withoutProxy.title !== 'via-proxy', withoutProxy.title || withoutProxy.err);

console.log(`\n${pass} pass, ${fail} fail`);
proxy.close();
process.exit(fail ? 1 : 0);
