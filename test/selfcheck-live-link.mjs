/** 验证：直播间链接能被识别并建任务 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9403;
const profile = path.join(os.tmpdir(), 'dy-live-link');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

let pass = 0;
let fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS', n, e); } else { fail++; console.log('FAIL', n, e); } };

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1500, height: 950 });
const ep = await waitEndpoint(port, 20000);
const cdp = await Cdp.connect((await newTab(port, 'http://127.0.0.1:9527/classic.html')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 6000));

await cdp.evaluate(`document.querySelector('[data-mod="live"]').click()`);
await new Promise((r) => setTimeout(r, 3000));

// 填两个直播间链接，解析测试（不真的建任务）
const parsed = await cdp.evaluate(`(() => {
  const links = ['https://live.douyin.com/324127181125', 'https://live.douyin.com/380637263487', 'https://www.douyin.com/video/7532780281573510446'];
  const out = { live: [], aweme: [], user: [] };
  for (const l of links) {
    const mLive = l.match(/live\\.douyin\\.com\\/(?:name\\/)?(\\d{6,})/);
    const m1 = l.match(/(?:\\/video\\/|modal_id=)(\\d{8,})/);
    const m2 = l.match(/\\/user\\/(MS4w[A-Za-z0-9_-]+)/);
    if (mLive) out.live.push(mLive[1]);
    else if (m1) out.aweme.push(m1[1]);
    else if (m2) out.user.push(m2[1]);
  }
  return out;
})()`);
console.log('解析结果:', JSON.stringify(parsed));
check('识别出 2 个直播间', parsed.live.length === 2, parsed.live.join(','));
check('识别出 1 个视频', parsed.aweme.length === 1);
check('直播间号正确', parsed.live[0] === '324127181125');

// 真的建一个任务（用已有的房间号，快速返回）
const before = await cdp.evaluate(`(async () => {
  const r = await fetch('/api/tasks?limit=1');
  const j = await r.json();
  return j.data?.[0]?.id || 0;
})()`);
const after = await cdp.evaluate(`(async () => {
  document.querySelector('#links').value = 'https://live.douyin.com/324127181125';
  await CL.start();
  await new Promise(r => setTimeout(r, 1200));
  const r = await fetch('/api/tasks?limit=1');
  const j = await r.json();
  return { id: j.data?.[0]?.id || 0, type: j.data?.[0]?.type || '' };
})()`);
check('点开始采集能建任务', after.id > before, `#${after.id} ${after.type}`);
check('任务类型是 live', after.type === 'live', after.type);

// 表格链接列
const linkCell = await cdp.evaluate(`(() => {
  CL.load();
  return new Promise((res) => setTimeout(() => {
    const tr = document.querySelector('#tbl tbody tr');
    const tds = tr ? [...tr.querySelectorAll('td')].map(t => t.textContent.trim()) : [];
    res(tds[7] || '');
  }, 1500));
})()`);
check('链接列显示 live.douyin.com', String(linkCell).includes('live.douyin.com'), linkCell);

await cdp.screenshot(path.resolve('test/live-link.png'));
console.log('\n截图: test/live-link.png');
console.log(`\n${pass} pass, ${fail} fail`);

cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
