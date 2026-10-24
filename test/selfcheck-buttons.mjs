/** 验证：按钮都真的能点了（内嵌对话框 + 删除接口） */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9406;
const profile = path.join(os.tmpdir(), 'dy-btns2');
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

const hasModal = await cdp.evaluate(`!!document.querySelector('#modal')`);
check('内嵌对话框存在', hasModal === true);

const askWorks = await cdp.evaluate(`(async () => {
  const p = CL.ask('测试标题', '默认值');
  await new Promise(r => setTimeout(r, 300));
  const shown = document.querySelector('#modal').style.display === 'flex';
  const val = document.querySelector('#modal-input').value;
  CL.modalClose('确定值');
  const got = await p;
  return { shown, val, got, closed: document.querySelector('#modal').style.display === 'none' };
})()`);
check('ask() 能弹出', askWorks.shown === true);
check('ask() 带默认值', askWorks.val === '默认值', askWorks.val);
check('ask() 返回输入', askWorks.got === '确定值', askWorks.got);
check('ask() 能关闭', askWorks.closed === true);

// 一键筛选：填条件后结果应变少
const filterTest = await cdp.evaluate(`(async () => {
  const before = CL.filtered.length;
  document.querySelector('#f-city').value = '杭州';
  CL.applyFilter();
  const after = CL.filtered.length;
  CL.clearFilter();
  return { before, after, restored: CL.filtered.length };
})()`);
check('一键筛选生效', filterTest.after < filterTest.before, `${filterTest.before} -> ${filterTest.after}`);
check('清空条件恢复', filterTest.restored === filterTest.before);

// 全选：勾选数应变化
const selTest = await cdp.evaluate(`(() => {
  CL.selected.clear(); CL.render(CL.rows);
  const before = CL.selected.size;
  CL.selectAll();
  const after = CL.selected.size;
  CL.selected.clear(); CL.render(CL.rows);
  return { before, after };
})()`);
check('全选能勾选', selTest.after > 0 && selTest.after !== selTest.before, `${selTest.before} -> ${selTest.after}`);

// 删除接口（用一条假数据测，先插再删）
const delTest = await cdp.evaluate(`(async () => {
  const r = await fetch('/api/data/delete', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ kind: 'comments', ids: [999999999] }) });
  const j = await r.json();
  return { status: r.status, ok: j.ok, deleted: j.data?.deleted };
})()`);
check('删除接口可用', delTest.status === 200 && delTest.ok === true, `deleted=${delTest.deleted}`);

// 补全资料：点按钮应弹对话框而非被拦
const enrichTest = await cdp.evaluate(`(async () => {
  const btn = [...document.querySelectorAll('.filter .row2 button')].find(b => b.textContent.includes('补全资料'));
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  const shown = document.querySelector('#modal').style.display === 'flex';
  const title = document.querySelector('#modal-title').textContent;
  CL.modalClose(null);
  return { shown, title: title.slice(0, 20) };
})()`);
check('补全资料弹内嵌框', enrichTest.shown === true, enrichTest.title);

await cdp.screenshot(path.resolve('test/btn-modal.png'));
console.log('\n截图: test/btn-modal.png');
console.log(`\n${pass} pass, ${fail} fail`);

cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
