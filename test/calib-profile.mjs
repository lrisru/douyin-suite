/** 用户页结构标定：关注/私信按钮、粉丝数字、tab 的真实 DOM 与点击效果 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const SEC = process.argv[3] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380rH-K8B91qq8KTo';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/aweme\/v1\/web\/(user|im)/.test(u)) reqs.push(u.split('?')[0]);
});

await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 8000 });
await new Promise((r) => setTimeout(r, 2500));

// 1. 关键元素 dump
const els = await cdp.evaluate(`(() => {
  const pick = (el) => el ? {
    tag: el.tagName,
    cls: (el.className || '').toString().slice(0, 80),
    e2e: el.getAttribute('data-e2e') || '',
    text: (el.innerText || '').trim().slice(0, 24),
    html: el.outerHTML.slice(0, 220),
  } : null;
  const byText = (re, scope) => [...(scope || document).querySelectorAll('button, div, span, a')]
    .find(e => re.test((e.innerText || '').trim()));

  const followBtn = document.querySelector('button[data-e2e="user-info-follow-btn"]') || byText(/^关注$/);
  const dmBtn = document.querySelector('[data-e2e="user-info-dm-btn"]') || byText(/^私信$/);
  const fansText = byText(/^粉丝\\s*[\\d.]+万?$/);
  const tabs = [...document.querySelectorAll('div[role="tab"], [data-e2e*="tab"], div')]
    .filter(e => /^(作品|推荐|喜欢|合集|短剧)\\s*\\d*$/.test((e.innerText || '').trim()))
    .slice(0, 8)
    .map(e => ({ text: (e.innerText||'').trim(), tag: e.tagName, e2e: e.getAttribute('data-e2e')||'', cls: (e.className||'').toString().slice(0,40) }));

  return { followBtn: pick(followBtn), dmBtn: pick(dmBtn), fansText: pick(fansText), tabs };
})()`);
console.log('关注按钮:', JSON.stringify(els.followBtn, null, 1));
console.log('私信按钮:', JSON.stringify(els.dmBtn, null, 1));
console.log('粉丝数字:', JSON.stringify(els.fansText, null, 1));
console.log('tabs:', JSON.stringify(els.tabs));

// 2. 点击粉丝数字
const pt = await cdp.evaluate(`(() => {
  const el = [...document.querySelectorAll('div, span, a')].find(e => /^粉丝\\s*[\\d.]+万?$/.test((e.innerText || '').trim()));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2, text: (el.innerText||'').trim() };
})()`);
console.log('\n点击粉丝:', JSON.stringify(pt));

if (pt) {
  reqs.length = 0;
  await cdp.clickPoint(pt.x, pt.y);
  await new Promise((r) => setTimeout(r, 4000));
  console.log('点击后请求:', JSON.stringify([...new Set(reqs)]));
  const after = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 100),
    modal: !!document.querySelector('[role="dialog"], [class*="modal"], [class*="Modal"]'),
    fansContainer: !!document.querySelector('[data-e2e="user-fans-container"]'),
    links: document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]').length,
    text: ((document.body.innerText||'').slice(-200)).replace(/\\s+/g,' '),
  }))()`);
  console.log('点击后:', JSON.stringify(after, null, 1));
  await cdp.screenshot(path.resolve('test/fans-modal.png'));
  console.log('截图 test/fans-modal.png');
}

fs.writeFileSync(path.resolve('test/calib-profile.json'), JSON.stringify({ SEC, els, pt }, null, 2));
cdp.close();
process.exit(0);
