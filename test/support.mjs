/**
 * 支撑模块：代理检测 / 卡密授权 / 通知 webhook。
 * 全部用本地服务验证，不依赖外网。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { testProxy, parseProxy } from '../src/proxy.js';
import { makeKey, verifyKey, machineCode, licenseStatus, activate } from '../src/license.js';
import { notifyAll } from '../src/notify.js';
import { initDb, getDb, setSetting } from '../src/db.js';
import { loadConfig } from '../src/util.js';

const tmpDir = path.resolve('test/.tmp-support');
fs.rmSync(tmpDir, { recursive: true, force: true });
const cfg = loadConfig(process.cwd());
cfg.dataDir = tmpDir;
initDb(cfg);

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

/* ---------------- 代理 ---------------- */
const received = [];
const proxyServer = http.createServer((req, res) => {
  received.push({ url: req.url, host: req.headers.host, auth: req.headers['proxy-authorization'] || '' });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ip: '203.0.113.9' }));
});
await new Promise((r) => proxyServer.listen(9367, '127.0.0.1', r));

const okProxy = await testProxy('http://127.0.0.1:9367');
check('代理可用', okProxy.ok === true && okProxy.exitIp === '203.0.113.9', `${okProxy.latency}ms ${okProxy.exitIp}`);

const deadProxy = await testProxy('http://127.0.0.1:1', 3000);
check('代理不可用', deadProxy.ok === false, deadProxy.error || '');

check('parseProxy http', JSON.stringify(parseProxy('http://u:p@1.2.3.4:8080')) === JSON.stringify({ protocol: 'http', host: '1.2.3.4', port: 8080, auth: 'u:p' }));
check('parseProxy 无协议', parseProxy('1.2.3.4:3128')?.port === 3128);
check('parseProxy socks 提示', (await testProxy('socks5://127.0.0.1:1080')).ok === false);
proxyServer.close();

/* ---------------- 卡密 ---------------- */
const secret = 'unit-test-secret-0123456789abcdef';
const machine = machineCode();
check('机器码格式', /^[0-9A-F]{4}(-[0-9A-F]{4}){5}$/.test(machine), machine);
check('机器码稳定', machine === machineCode());

const key = makeKey(secret, machine, '2099-12-31');
const v1 = verifyKey(secret, machine, key);
check('卡密校验通过', v1.ok === true, key);

const v2 = verifyKey(secret, 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', key);
check('换机器拒绝', v2.ok === false, v2.reason);

const badKey = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
check('篡改卡密拒绝', verifyKey(secret, machine, badKey).ok === false);

const expired = makeKey(secret, machine, '2020-01-01');
const v3 = verifyKey(secret, machine, expired);
check('过期卡密拒绝', v3.ok === false, v3.reason);

check('格式错误拒绝', verifyKey(secret, machine, 'not-a-key').ok === false);

// 授权开关
const cfg2 = { ...cfg, license: { enabled: true, secret } };
check('未激活时无效', licenseStatus(cfg2).valid === false);
const act = activate(cfg2, key);
check('激活成功', act.ok === true, act.expiry);
check('激活后有效', licenseStatus(cfg2).valid === true, licenseStatus(cfg2).expiry);
setSetting('license_key', '');
check('关闭开关后放行', licenseStatus(cfg).valid === true);

/* ---------------- 通知 ---------------- */
const hooks = [];
const hookServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    hooks.push({ path: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => hookServer.listen(9368, '127.0.0.1', r));

const notifyCfg = {
  notify: {
    feishu: 'http://127.0.0.1:9368/feishu',
    dingtalk: 'http://127.0.0.1:9368/dingtalk',
    wechat: 'http://127.0.0.1:9368/wechat',
  },
};
const results = await notifyAll(notifyCfg, '测试通知内容');
await new Promise((r) => setTimeout(r, 300));

check('三个通道都发出', results.length === 3 && results.every((r) => r.status === 'fulfilled'), String(results.length));
const feishu = hooks.find((h) => h.path === '/feishu');
const ding = hooks.find((h) => h.path === '/dingtalk');
const wechat = hooks.find((h) => h.path === '/wechat');
check('飞书格式', feishu?.body?.msg_type === 'text' && feishu?.body?.content?.text === '测试通知内容', JSON.stringify(feishu?.body));
check('钉钉格式', ding?.body?.msgtype === 'text' && ding?.body?.text?.content === '测试通知内容', JSON.stringify(ding?.body));
check('企业微信格式', wechat?.body?.msgtype === 'text' && wechat?.body?.text?.content === '测试通知内容', JSON.stringify(wechat?.body));

hookServer.close();

console.log(`\n${pass} pass, ${fail} fail`);
try { getDb().close(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 300));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
