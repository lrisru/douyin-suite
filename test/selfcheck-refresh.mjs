/** 验证：采集完成后列表自动刷新 + 刷新按钮可用 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9404;
const profile = path.join(os.tmpdir(), 'dy-refresh');
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

// 刷新按钮存在
const hasBtn = await cdp.evaluate(`[...document.querySelectorAll('.links-area button')].some(b => b.textContent.includes('刷新'))`);
check('有「刷新数据」按钮', hasBtn === true);

// 切到直播间，记录当前条数
await cdp.evaluate(`document.querySelector('[data-mod="live"]').click()`);
await new Promise((r) => setTimeout(r, 3000));
const before = await cdp.evaluate(`({ total: document.querySelector('#st-total').textContent, rows: document.querySelectorAll('#tbl tbody tr').length })`);
console.log('采集前:', JSON.stringify(before));

// 手动执行一次 refresh
const after = await cdp.evaluate(`(async () => {
  await CL.refresh();
  return { total: document.querySelector('#st-total').textContent, rows: document.querySelectorAll('#tbl tbody tr').length, status: document.querySelector('#st-msg').textContent };
})()`);
console.log('刷新后:', JSON.stringify(after));
check('刷新后条数不变（数据一致）', after.total === before.total, `${before.total} -> ${after.total}`);
check('状态栏有反馈', /条/.test(after.status), after.status);

// 建一个真实采集任务，验证 poll 会更新
const flow = await cdp.evaluate(`(async () => {
  const startTotal = Number(document.querySelector('#st-total').textContent) || 0;
  document.querySelector('#links').value = 'https://live.douyin.com/393555180511';
  await CL.start();
  // 等 poll 跑完（最多 60 秒）
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await new Promise(r => setTimeout(r, 3000));
    const s = document.querySelector('#st-msg').textContent || '';
    if (s.includes('完成')) break;
  }
  return {
    startTotal,
    endTotal: Number(document.querySelector('#st-total').textContent) || 0,
    status: document.querySelector('#st-msg').textContent,
    rows: document.querySelectorAll('#tbl tbody tr').length,
  };
})()`);
console.log('采集流程:', JSON.stringify(flow));
check('poll 有结束状态', /完成/.test(flow.status || ''), flow.status);
check('列表已刷新有数据', flow.rows > 0, `${flow.rows} 行`);

await cdp.screenshot(path.resolve('test/refresh-check.png'));
console.log('\n截图: test/refresh-check.png');
console.log(`\n${pass} pass, ${fail} fail`);

cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
