/**
 * 粉丝/关注列表标定：打开用户页，尝试几种入口，dump 所有相关请求与页面结构。
 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const SEC = process.argv[2] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380r-H-K8B91qq8KTo';

const targets = await listTargets(PORT);
const page = targets.find((t) => t.type === 'page' && /douyin/.test(t.url)) || targets.find((t) => t.type === 'page');
if (!page) { console.error('no page'); process.exit(1); }
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
const offReq = cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/aweme\/v1\/web\/(user|im)|imapi|webcast/.test(u)) reqs.push(u.slice(0, 160));
});

console.log('当前页面:', await cdp.evaluate('location.href'));

// 1. 直接带 showTab 参数
await cdp.navigate(`https://www.douyin.com/user/${SEC}?showTab=followers`, { waitMs: 6000 });
console.log('\n[1] ?showTab=followers 后请求数:', reqs.length);
for (const u of reqs.slice(-6)) console.log('   ', u);

// 2. 页面上找"粉丝"tab 并点击
reqs.length = 0;
const tabs = await cdp.evaluate(`(() => {
  const out = [];
  for (const el of document.querySelectorAll('div[role="tab"], span, a')) {
    const t = (el.innerText || '').trim();
    if (/^(作品|粉丝|关注|喜欢|收藏|私密)$/.test(t) && t.length <= 4) {
      out.push({ text: t, tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), e2e: el.getAttribute('data-e2e') || '' });
    }
  }
  return out.slice(0, 12);
})()`);
console.log('\n[2] 页面上的 tab:', JSON.stringify(tabs, null, 1));

const clicked = await cdp.evaluate(`(() => {
  const els = [...document.querySelectorAll('div[role="tab"], span, a, div')];
  const el = els.find(x => (x.innerText || '').trim() === '粉丝');
  if (!el) return { ok: false };
  el.scrollIntoView({ block: 'center' });
  el.click();
  const r = el.getBoundingClientRect();
  return { ok: true, x: r.x, y: r.y, tag: el.tagName, cls: (el.className||'').toString().slice(0,50) };
})()`);
console.log('   点击粉丝:', JSON.stringify(clicked));

if (clicked.ok) {
  await cdp.pointClick?.(clicked.x, clicked.y);
  await cdp.clickPoint(clicked.x, clicked.y);
  await new Promise((r) => setTimeout(r, 6000));
}
console.log('\n[3] 点击后请求:');
for (const u of reqs.slice(-10)) console.log('   ', u);

const after = await cdp.evaluate(`(() => ({
  url: location.href,
  hasList: !!document.querySelector('[data-e2e="user-fans-container"], div[data-e2e*="fans"]'),
  listItems: document.querySelectorAll('[data-e2e="user-fans-container"] div, div[data-e2e="user-info"]').length,
  text: (document.body.innerText || '').slice(0, 120).replace(/\\s+/g, ' '),
}))()`);
console.log('\n[4] 页面状态:', JSON.stringify(after));

// 3. 再滚一下，看是否加载更多
reqs.length = 0;
for (let i = 0; i < 3; i++) {
  await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
  await new Promise((r) => setTimeout(r, 1500));
}
console.log('\n[5] 滚动后请求:');
for (const u of reqs.slice(-10)) console.log('   ', u);

offReq();
const out = path.resolve('test/calib-followers.json');
fs.writeFileSync(out, JSON.stringify({ sec: SEC, reqs: reqs.slice(), after }, null, 2));
console.log('\n报告:', out);
cdp.close();
process.exit(0);
