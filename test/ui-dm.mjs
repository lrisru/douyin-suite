/** 验证「数据页勾选评论 → 一键私信」的界面链路 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const BASE = 'http://127.0.0.1:9527';
const port = 9390;
const profile = path.join(os.tmpdir(), 'dy-ui-dm');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1440, height: 980 });
const ep = await waitEndpoint(port, 20000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, BASE + '/')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 2500));

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

// 切到数据页，选评论
await cdp.evaluate(`document.querySelector('button[data-tab="data"]').click()`);
await new Promise((r) => setTimeout(r, 800));
await cdp.evaluate(`(() => {
  const sel = document.querySelector('#d-kind');
  sel.value = 'comments';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await cdp.evaluate(`(() => {
  const b = [...document.querySelectorAll('#panel-data button')].find(x => x.textContent.trim() === '查询');
  b.click();
})()`);
await new Promise((r) => setTimeout(r, 2000));

const layout = await cdp.evaluate(`(() => ({
  selCount: document.querySelectorAll('.d-sel').length,
  hasAll: !!document.querySelector('#d-all'),
  dmBtn: [...document.querySelectorAll('#panel-data button')].some(b => b.textContent.trim() === '私信选中用户'),
  copyBtn: [...document.querySelectorAll('#panel-data button')].some(b => b.textContent.trim() === '复制选中 sec_uid'),
  header: document.querySelector('#tbl-data thead').innerText.replace(/\\s+/g, ' ').slice(0, 80),
}))()`);
console.log('布局:', JSON.stringify(layout));
check('评论表带勾选框', layout.selCount > 0, `rows=${layout.selCount}`);
check('全选框存在', layout.hasAll === true);
check('一键私信按钮存在', layout.dmBtn === true);
check('复制按钮存在', layout.copyBtn === true);

// 勾选前 3 行
const picked = await cdp.evaluate(`(() => {
  const boxes = [...document.querySelectorAll('.d-sel')].slice(0, 3);
  boxes.forEach(b => { b.checked = true; });
  return App.selectedSecUids();
})()`);
console.log('选中:', JSON.stringify(picked.map((x) => ({ name: x.name, sec: x.sec.slice(0, 20) }))));
check('选中能收集到 sec_uid', picked.length === 3 && picked.every((x) => /^MS4wLjAB/.test(x.sec)), `${picked.length} 个`);

// 去重
const dup = await cdp.evaluate(`(() => {
  const first = document.querySelector('.d-sel');
  first.checked = true;
  return App.selectedSecUids().length;
})()`);
check('重复勾选不重复计数', dup === 3, String(dup));

// 其他数据源不应出现勾选框
await cdp.evaluate(`(() => {
  const sel = document.querySelector('#d-kind');
  sel.value = 'items';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const b = [...document.querySelectorAll('#panel-data button')].find(x => x.textContent.trim() === '查询');
  b.click();
})()`);
await new Promise((r) => setTimeout(r, 1500));
const itemsSel = await cdp.evaluate(`document.querySelectorAll('.d-sel').length`);
check('作品表没有勾选框', itemsSel === 0, String(itemsSel));

console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
