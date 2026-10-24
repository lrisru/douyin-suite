/** 诊断：评论模块的按钮点了为什么没反应 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9405;
const profile = path.join(os.tmpdir(), 'dy-btns');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1500, height: 950 });
const ep = await waitEndpoint(port, 20000);
const cdp = await Cdp.connect((await newTab(port, 'http://127.0.0.1:9527/classic.html')).webSocketDebuggerUrl);
await cdp.enable();

const logs = [];
cdp.on('Runtime.exceptionThrown', (p) => logs.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '')));
cdp.on('Runtime.consoleAPICalled', (p) => logs.push(p.type + ': ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')));
await cdp.send('Runtime.enable');
await new Promise((r) => setTimeout(r, 6000));

// 1. 函数存在性
const fns = await cdp.evaluate(`(() => {
  const names = ['applyFilter','clearFilter','enrichComments','exportExcel','importExcel','genScript','dmSelected','selectAll','refresh','load','render','start','stop'];
  const out = {};
  for (const n of names) out[n] = typeof CL[n];
  out.__CL_exists = typeof CL;
  return out;
})()`);
console.log('函数存在性:', JSON.stringify(fns, null, 1));

// 2. 按钮绑定
const btns = await cdp.evaluate(`(() => [...document.querySelectorAll('.filter .row2 button')].map(b => ({
  text: b.textContent.trim(),
  onclick: (b.getAttribute('onclick') || '').slice(0, 40),
  disabled: b.disabled,
})))()`);
console.log('\\n按钮绑定:', JSON.stringify(btns, null, 1));

// 3. 逐个点，看是否有异常
for (const label of ['一键筛选', '全选', '生成话术', '补全资料']) {
  logs.length = 0;
  const r = await cdp.evaluate(`(async () => {
    const b = [...document.querySelectorAll('.filter .row2 button')].find(x => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return { found: false };
    const before = document.querySelector('#st-msg')?.textContent || '';
    b.click();
    await new Promise(r => setTimeout(r, 1200));
    return { found: true, before, after: document.querySelector('#st-msg')?.textContent || '' };
  })()`);
  console.log(`\\n点「${label}」:`, JSON.stringify(r));
  if (logs.length) console.log('  控制台:', logs.slice(0, 3).join(' | '));
}

cdp.close();
await new Promise((r) => setTimeout(r, 300));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 400));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
