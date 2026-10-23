/** 粉丝列表标定 v3：从精选页找真实作者 → 打开主页 → 点粉丝 → 抓请求 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/aweme\/v1\/web\/user\/|imapi/.test(u)) reqs.push(u.split('?')[0]);
});

// 1. 精选页找作者
await cdp.navigate('https://www.douyin.com/jingxuan', { waitMs: 6000 });
const authors = await cdp.evaluate(`(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/user/"]')) {
    const m = (a.getAttribute('href') || '').match(/\\/user\\/(MS4wLjAB[\\w-]+)/);
    if (m) out.push({ sec: m[1], name: (a.innerText || '').trim().slice(0, 20) });
  }
  return [...new Map(out.map(x => [x.sec, x])).values()].slice(0, 5);
})()`);
console.log('精选页作者:', JSON.stringify(authors));

if (!authors.length) { console.error('没找到作者'); process.exit(1); }
const target = authors[0];

// 2. 打开作者主页
reqs.length = 0;
await cdp.navigate(`https://www.douyin.com/user/${target.sec}`, { waitMs: 8000 });
await new Promise((r) => setTimeout(r, 2500));

const s1 = await cdp.evaluate(`(() => ({
  url: location.href.slice(0, 90),
  title: document.title,
  notExist: /用户不存在/.test(document.body.innerText || ''),
  hasUserInfo: !!document.querySelector('div[data-e2e="user-info"]'),
  tabs: [...document.querySelectorAll('div[role="tab"], span, a, div')]
    .map(e => (e.innerText || '').trim())
    .filter(t => /^(作品|粉丝|关注|喜欢)\\s*\\d*$/.test(t)).slice(0, 8),
  bodyLen: (document.body.innerText || '').length,
}))()`);
console.log('[主页]', JSON.stringify(s1, null, 1));
console.log('请求:', JSON.stringify([...new Set(reqs)]));

// 3. 点粉丝
const tabSel = await cdp.evaluate(`(() => {
  const cands = [...document.querySelectorAll('div[role="tab"], span, a, div')];
  const hit = cands.find(e => /^粉丝\\s*\\d*$/.test((e.innerText || '').trim()));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { text: (hit.innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2, cls: (hit.className||'').toString().slice(0,40), e2e: hit.getAttribute('data-e2e') || '', tag: hit.tagName };
})()`);
console.log('[粉丝 tab]', JSON.stringify(tabSel));

if (tabSel) {
  reqs.length = 0;
  await cdp.clickPoint(tabSel.x, tabSel.y);
  await new Promise((r) => setTimeout(r, 5000));
  console.log('[点击后请求]', JSON.stringify([...new Set(reqs)]));

  for (let i = 0; i < 3; i++) {
    await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('[滚动后请求]', JSON.stringify([...new Set(reqs)]));

  const s2 = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 100),
    fansContainer: !!document.querySelector('[data-e2e="user-fans-container"]'),
    userLinks: document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]').length,
    sample: [...document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]')].slice(0,2).map(a => (a.innerText||'').trim().slice(0,30)),
  }))()`);
  console.log('[粉丝页]', JSON.stringify(s2, null, 1));
}

const shot = path.resolve('test/followers-page.png');
await cdp.screenshot(shot);
fs.writeFileSync(path.resolve('test/calib-followers.json'), JSON.stringify({ target, s1, tabSel, reqs }, null, 2));
console.log('截图:', shot);
cdp.close();
process.exit(0);
