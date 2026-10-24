/** 验证直播间模块 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9402;
const profile = path.join(os.tmpdir(), 'dy-live-ui');
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

const menu = await cdp.evaluate(`[...document.querySelectorAll('.menubar [data-mod]')].map(b => b.textContent.trim())`);
check('菜单含「【采集】直播间」', menu.some((m) => m.includes('直播间')), menu.join(' / '));

await cdp.evaluate(`document.querySelector('[data-mod="live"]').click()`);
await new Promise((r) => setTimeout(r, 3500));

const s = await cdp.evaluate(`(() => ({
  cols: [...document.querySelectorAll('#tbl thead th')].map(t => t.textContent.trim()).filter(Boolean),
  rows: document.querySelectorAll('#tbl tbody tr').length,
  total: document.querySelector('#st-total')?.textContent,
  firstRows: [...document.querySelectorAll('#tbl tbody tr')].slice(0, 3).map(tr => [...tr.querySelectorAll('td')].map(t => t.textContent.trim()).slice(1, 6)),
  danmuBtnVisible: document.querySelector('#btn-danmu')?.style.display !== 'none',
  filterHidden: document.querySelector('.filter')?.style.display === 'none',
}))()`);
console.log(JSON.stringify(s, null, 1));

check('直播间表格 7 列', s.cols.length === 7, s.cols.join('|'));
check('有直播数据', s.rows > 0, `${s.rows} 行 / ${s.total}`);
check('「采弹幕」按钮可见', s.danmuBtnVisible === true);
check('筛选区隐藏（评论专用）', s.filterHidden === true);

const hasTitle = s.firstRows.some((r) => r[1] && r[1].length > 2);
check('标题列有内容', hasTitle, JSON.stringify(s.firstRows[0]));

await cdp.screenshot(path.resolve('test/mod-live.png'));
console.log('\n截图: test/mod-live.png');
console.log(`\n${pass} pass, ${fail} fail`);

cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
