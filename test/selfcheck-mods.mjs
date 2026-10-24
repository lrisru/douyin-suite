/** 验证四个采集模块的界面确实不同 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9400;
const profile = path.join(os.tmpdir(), 'dy-mods');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

let pass = 0;
let fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS', n, e); } else { fail++; console.log('FAIL', n, e); } };

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1500, height: 950 });
const ep = await waitEndpoint(port, 20000);
const cdp = await Cdp.connect((await newTab(port, 'http://127.0.0.1:9527/classic.html')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 7000));

const snap = async () => cdp.evaluate(`(() => {
  const vis = (s) => { const e = document.querySelector(s); return !!e && e.style.display !== 'none'; };
  return {
    cols: [...document.querySelectorAll('#tbl thead th')].map((t) => t.textContent.trim()).filter(Boolean),
    rows: document.querySelectorAll('#tbl tbody tr').length,
    searchVisible: vis('#search-area'),
    linksVisible: vis('.links-area:not(#search-area)'),
    watchVisible: vis('#watch-panel'),
    status: document.querySelector('#st-msg')?.textContent,
    total: document.querySelector('#st-total')?.textContent,
  };
})()`);

// 1. 视频评论（默认）
let s = await snap();
check('视频评论：12 列', s.cols.length === 12, s.cols.join('|').slice(0, 60));
check('视频评论：链接框可见', s.linksVisible === true);
check('视频评论：有关键词框？否', s.searchVisible === false);
check('视频评论：有数据', s.rows > 0, `${s.rows} 行 / ${s.total}`);

// 2. 搜索视频
await cdp.evaluate(`document.querySelector('[data-mod="search-video"]').click()`);
await new Promise((r) => setTimeout(r, 3000));
s = await snap();
check('搜索视频：9 列', s.cols.length === 9, s.cols.join('|').slice(0, 60));
check('搜索视频：关键词框可见', s.searchVisible === true);
check('搜索视频：链接框隐藏', s.linksVisible === false);
check('搜索视频：有数据', s.rows > 0, `${s.rows} 行 / ${s.total}`);

// 3. 群成员
await cdp.evaluate(`document.querySelector('[data-mod="group"]').click()`);
await new Promise((r) => setTimeout(r, 2500));
s = await snap();
check('群成员：9 列', s.cols.length === 9, s.cols.join('|').slice(0, 60));
check('群成员：显示用户数据', s.cols.includes('昵称') && s.cols.includes('sec_uid'));
check('群成员：有数据', s.rows > 0, `${s.rows} 行 / ${s.total}`);

// 4. 视频/用户
await cdp.evaluate(`document.querySelector('[data-mod="video-user"]').click()`);
await new Promise((r) => setTimeout(r, 2500));
s = await snap();
check('视频/用户：9 列', s.cols.length === 9);
check('视频/用户：有数据', s.rows > 0, `${s.rows} 行`);

// 5. 自动化操作区
await cdp.evaluate(`document.querySelector('[data-mod="auto"]').click()`);
await new Promise((r) => setTimeout(r, 2500));
s = await snap();
check('自动化区：监控面板可见', s.watchVisible === true);
check('自动化区：链接框隐藏', s.linksVisible === false);
check('自动化区：关键词框隐藏', s.searchVisible === false);

// 截图
await cdp.evaluate(`document.querySelector('[data-mod="search-video"]').click()`);
await new Promise((r) => setTimeout(r, 2500));
await cdp.screenshot(path.resolve('test/mod-search.png'));
await cdp.evaluate(`document.querySelector('[data-mod="comments"]').click()`);
await new Promise((r) => setTimeout(r, 2500));
await cdp.screenshot(path.resolve('test/mod-comments.png'));
console.log('\n截图: test/mod-search.png, test/mod-comments.png');

console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
