/** 下载链路验证（走页面详情）：node test/download2.mjs [aweme_id] */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { DouyinService } from '../src/douyin.js';
import { loadConfig, sleep } from '../src/util.js';

const id = process.argv[2] || '7532780281573510446';
const cfg = loadConfig(process.cwd());
const port = 9351;
const profile = path.resolve('test/.probe-profile7');
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: false, width: 1100, height: 800 });
const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();

const douyin = new DouyinService({ page: async () => ({ cdp }) }, cfg);
console.log('作品:', id);

const detail = await douyin.awemeDetailFromPage({ id: 1 }, id);
console.log('页面详情:', detail ? `desc=${(detail.desc || '').slice(0, 30)} play=${detail.video?.play_addr?.url_list?.length || 0} 条` : '(未取到)');

const r = await douyin.download({ id: 1 }, { awemeIds: [id] });
console.log('目录:', r.dir);
for (const x of r.results) {
  console.log('  ->', x.ok ? 'OK' : 'FAIL', x.source || '', x.files?.map((f) => `${path.basename(f.file)}(${(f.size / 1024 / 1024).toFixed(2)}MB)`).join(', ') || x.reason);
}
const files = fs.existsSync(r.dir) ? fs.readdirSync(r.dir) : [];
console.log('落盘:', files.join(', ') || '(空)');

cdp.close();
await sleep(300);
try { process.kill(chrome.pid); } catch { /* ignore */ }
process.exit(0);
