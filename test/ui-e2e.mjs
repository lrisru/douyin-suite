/**
 * 控制台端到端：真实点击 UI（新增账号 / 创建定时任务 / 查询数据 / SSE 日志），
 * 验证前端 JS 实际执行，而不只是渲染。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const BASE = 'http://127.0.0.1:9527';
const port = 9362;
const profile = path.join(os.tmpdir(), 'dy-ui-e2e');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: true, width: 1440, height: 980 });
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

const clickTab = (tab) => cdp.evaluate(`(() => { const b = document.querySelector('button[data-tab="${tab}"]'); if (!b) return false; b.click(); return true; })()`);
const clickButton = (panel, text) => cdp.evaluate(`(() => {
  const b = [...document.querySelectorAll('#panel-${panel} button')].find(x => (x.textContent || '').trim() === ${JSON.stringify(text)});
  if (!b) return false; b.click(); return true;
})()`);
const setValue = (sel, val) => cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
const text = (sel) => cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.innerText : null; })()`);
const count = (sel) => cdp.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

// 0. 页面结构
const tabs = await cdp.evaluate('[...document.querySelectorAll("#tabs button")].map(b=>b.textContent)');
check('10 个页签', tabs.length === 10, tabs.join('/'));
check('App 已初始化', await cdp.evaluate('!!window.App && !!App.state'), '');

// 1. 账号：填名字 → 新增
await clickTab('accounts');
await setValue('#acc-name', 'UI测试号');
await setValue('#acc-note', 'e2e');
const clickedAdd = await clickButton('accounts', '新增账号');
await new Promise((r) => setTimeout(r, 1200));
const accRows = await count('#tbl-accounts tbody tr');
const accText = await text('#tbl-accounts tbody');
check('新增账号按钮可点', clickedAdd === true);
check('账号行出现', accRows >= 1 && /UI测试号/.test(accText || ''), `rows=${accRows}`);

// 2. 定时任务：填表单 → 创建
await clickTab('schedules');
await setValue('#sc-name', 'UI定时测试');
await setValue('#sc-type', 'search_video');
await setValue('#sc-params', '{"keyword":"测试","limit":5}');
await setValue('#sc-interval', '15');
const clickedSc = await clickButton('schedules', '创建');
await new Promise((r) => setTimeout(r, 1200));
const scRows = await count('#tbl-schedules tbody tr');
const scText = await text('#tbl-schedules tbody');
check('定时任务创建', clickedSc === true && scRows >= 1 && /UI定时测试/.test(scText || ''), `rows=${scRows}`);

// 3. 数据页：查询（空数据也要正常渲染）
await clickTab('data');
await new Promise((r) => setTimeout(r, 800));
const dCount = await text('#d-count');
check('数据页查询', /共 \d+ 条/.test(dCount || ''), dCount || '');

// 4. 换数据源（会话）
await setValue('#d-kind', 'conversations');
await clickButton('data', '查询');
await new Promise((r) => setTimeout(r, 800));
const dCount2 = await text('#d-count');
check('切换数据源', /共 \d+ 条/.test(dCount2 || ''), dCount2 || '');

// 5. 直播页：切换 + 统计栏
await clickTab('live');
await new Promise((r) => setTimeout(r, 600));
check('直播页统计栏', (await text('#lv-stats')) !== null, await text('#lv-stats'));

// 6. SSE：制造一条日志（建一个会失败的任务），看日志面板是否收到
const before = await count('#log-view .line');
await cdp.evaluate(`fetch('/api/tasks', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({type:'search_video', params:{keyword:'sse-test'}})})`);
await new Promise((r) => setTimeout(r, 2500));
const after = await count('#log-view .line');
check('SSE 日志推送', after > before, `${before} -> ${after}`);

// 7. 账号表格里的操作按钮存在
const ops = await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('#tbl-accounts button')].map(x=>x.textContent); return b; })()`);
check('账号操作按钮齐全', ['打开登录', '检查登录', '代理', '指纹', '关闭', '删除'].every((t) => ops.includes(t)), ops.join(','));

// 8. 设置页加载
await clickTab('settings');
await new Promise((r) => setTimeout(r, 600));
const conc = await setValue('#s-conc', '2');
check('设置页可编辑', conc === true);

// 清理：删账号 / 删定时任务
const accId = await cdp.evaluate('App.state.accounts[0]?.id || 0');
const scId = await cdp.evaluate('App.state.schedules[0]?.id || 0');
if (accId) await cdp.evaluate(`fetch('/api/accounts/${accId}', {method:'DELETE'})`);
if (scId) await cdp.evaluate(`fetch('/api/schedules/${scId}', {method:'DELETE'})`);
await new Promise((r) => setTimeout(r, 800));

console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
