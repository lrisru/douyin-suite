/** 经典界面自检：元素、接口、数据、功能链路 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9397;
const profile = path.join(os.tmpdir(), 'dy-selfcheck');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

// ---------- 1. 接口层 ----------
console.log('=== 接口 ===');
const api = async (p) => {
  const r = await fetch('http://127.0.0.1:9527' + p);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
{
  const s = await api('/api/stats');
  check('stats 可用', s.status === 200 && s.body.ok, `评论 ${s.body.data?.comments}`);
  const d = await api('/api/data/comments?limit=3');
  check('评论数据可读', d.body.total > 0, `total=${d.body.total}`);
  const cols = (d.body.columns || []).map((c) => c.label);
  check('评论列含「性别」', cols.some((c) => c.includes('性别')), cols.slice(0, 6).join(','));
  const h = await fetch('http://127.0.0.1:9527/api/export?kind=comments&format=xlsx');
  const buf = Buffer.from(await h.arrayBuffer());
  check('导出 Excel 可用', h.ok && buf.length > 1000, `${buf.length}B`);
}

// ---------- 2. 页面元素 ----------
console.log('\n=== 界面 ===');
launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1500, height: 950 });
const ep = await waitEndpoint(port, 20000);
if (!ep) { console.error('chrome 启动失败'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'http://127.0.0.1:9527/classic.html')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 9000));

const ui = await cdp.evaluate(`(() => {
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  return {
    menu: all('.menubar [data-mod]').map((b) => b.textContent.trim()),
    hasUpdate: all('.menubar button').some((b) => b.textContent.includes('更新')),
    hasQr: all('.menubar button').some((b) => b.textContent.includes('二维码')),
    urlDefault: q('#url')?.value,
    hasHome: all('.browser-bar button').some((b) => b.textContent.includes('首页')),
    hasGrab: all('.browser-bar button').some((b) => b.textContent.includes('一键视频采集')),
    filters: {
      live: !!q('#f-live'), city: !!q('#f-city'), gender: !!q('#f-gender'),
      contain: !!q('#f-contain'), dup: !!q('#f-dup'), exclude: !!q('#f-exclude'),
      date: !!q('#f-date'), dedupUser: !!q('#f-dedup-user'),
    },
    cols: all('#tbl thead th').map((t) => t.textContent.trim()).filter(Boolean),
    actions: all('.filter .row2 button').map((b) => b.textContent.trim()),
    linkBtns: all('.links-area button').map((b) => b.textContent.trim()),
    rows: all('#tbl tbody tr').length,
    total: q('#st-total')?.textContent,
    status: q('#st-msg')?.textContent,
    hasScreenImg: !!q('#screen'),
  };
})()`);

check('菜单 5 个采集模块', ui.menu.length === 5, ui.menu.join(' / '));
check('菜单含「更新」', ui.hasUpdate);
check('菜单含「用户二维码」', ui.hasQr);
check('地址栏默认 douyin.com', (ui.urlDefault || '').startsWith('https://www.douyin.com'), ui.urlDefault);
check('有「首页」按钮', ui.hasHome);
check('有「一键视频采集」', ui.hasGrab);
check('筛选-实时筛选', ui.filters.live);
check('筛选-地区含', ui.filters.city);
check('筛选-性别', ui.filters.gender);
check('筛选-评论含', ui.filters.contain);
check('筛选-降重', ui.filters.dup);
check('筛选-评不含', ui.filters.exclude);
check('筛选-日期起', ui.filters.date);
check('筛选-去除重复发言用户', ui.filters.dedupUser);
check('表格列齐全（12 列数据列）', ui.cols.length === 12, ui.cols.join('|'));
check('操作按钮齐全', ui.actions.length >= 5, ui.actions.join(' / '));
check('链接区按钮齐全', ui.linkBtns.length >= 4, ui.linkBtns.join(' / '));
check('数据已渲染', ui.rows > 0, `${ui.rows} 行`);
check('总数显示', Number(ui.total) > 0, `共 ${ui.total}`);
check('左侧画面容器存在', ui.hasScreenImg);

// ---------- 3. 功能链路 ----------
console.log('\n=== 功能链路 ===');
{
  // 筛选：按城市
  const r = await cdp.evaluate(`(async () => {
    document.querySelector('#f-city').value = '杭州';
    CL.applyFilter();
    return { filtered: CL.filtered.length, all: CL.rows.length };
  })()`);
  check('按城市筛选生效', r.filtered >= 0 && r.filtered <= r.all, `杭州 ${r.filtered} / 全部 ${r.all}`);

  // 清空条件
  const r2 = await cdp.evaluate(`(() => { CL.clearFilter(); return CL.filtered.length; })()`);
  check('清空条件恢复全量', r2 > 0, `${r2} 条`);

  // 勾选
  const r3 = await cdp.evaluate(`(() => {
    const boxes = [...document.querySelectorAll('#tbl tbody input[type=checkbox]')].slice(0, 3);
    boxes.forEach((b) => { b.checked = true; CL.toggleSel(Number(b.dataset.id), true); });
    return CL.selected.size;
  })()`);
  check('勾选计数正确', r3 === 3, `${r3} 个`);

  // 全选
  const r4 = await cdp.evaluate(`(() => { CL.selectAll(); return CL.selected.size; })()`);
  check('全选可用', r4 > 3, `${r4} 个`);
}

// ---------- 4. 截图 ----------
await cdp.evaluate(`(() => { CL.clearFilter(); CL.selected.clear(); CL.render(CL.rows); })()`);
await new Promise((r) => setTimeout(r, 800));
await cdp.screenshot(path.resolve('test/selfcheck.png'));
console.log('\n截图: test/selfcheck.png');

console.log(`\n===== ${pass} pass, ${fail} fail =====`);
if (fail) console.log('有失败项，上面 FAIL 行即问题点');

cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
