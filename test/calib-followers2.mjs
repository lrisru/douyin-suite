/** 粉丝列表标定 v2：用户页加载后检查 tab 结构，点击粉丝并抓请求 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[3] || 9301);
const SEC = process.argv[2] || process.argv[2] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380r-H-K8B91qq8KTo';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/aweme\/v1\/web\/user\//.test(u)) reqs.push(u.split('?')[0]);
});

await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 8000 });
await new Promise((r) => setTimeout(r, 3000));

const s1 = await cdp.evaluate(`(() => ({
  url: location.href.slice(0, 90),
  title: document.title,
  hasUserInfo: !!document.querySelector('div[data-e2e="user-info"]'),
  userInfoText: (document.querySelector('div[data-e2e="user-info"]')?.innerText || '').slice(0, 80).replace(/\\s+/g, ' '),
  tabs: [...document.querySelectorAll('div[role="tab"], span, a, div')]
    .map(e => (e.innerText || '').trim())
    .filter(t => /^(作品|粉丝|关注|喜欢)\\s*\\d*$/.test(t))
    .slice(0, 8),
  bodyLen: (document.body.innerText || '').length,
}))()`);
console.log('[页面]', JSON.stringify(s1, null, 1));
console.log('已发请求:', JSON.stringify([...new Set(reqs)]));

// 找粉丝 tab
const tabSel = await cdp.evaluate(`(() => {
  const cands = [...document.querySelectorAll('div[role="tab"], span, a, div')];
  const hit = cands.find(e => /^粉丝\\s*\\d*$/.test((e.innerText || '').trim()));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { text: (hit.innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2, cls: (hit.className||'').toString().slice(0, 40), e2e: hit.getAttribute('data-e2e') || '' };
})()`);
console.log('[粉丝 tab]', JSON.stringify(tabSel));

if (tabSel) {
  reqs.length = 0;
  await cdp.clickPoint(tabSel.x, tabSel.y);
  await new Promise((r) => setTimeout(r, 5000));
  console.log('[点击后请求]', JSON.stringify([...new Set(reqs)]));
  const s2 = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 90),
    fansContainer: !!document.querySelector('[data-e2e="user-fans-container"]'),
    items: document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]').length,
    text: (document.body.innerText || '').slice(0, 120).replace(/\\s+/g, ' '),
  }))()`);
  console.log('[粉丝页]', JSON.stringify(s2, null, 1));

  // 滚动加载
  for (let i = 0; i < 2; i++) {
    await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('[滚动后请求]', JSON.stringify([...new Set(reqs)]));
  const s3 = await cdp.evaluate(`(() => ({
    items: document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]').length,
  }))()`);
  console.log('[滚动后]', JSON.stringify(s3));
}

const shot = path.resolve('test/followers-page.png');
await cdp.screenshot(shot);
const out = path.resolve('test/calib-followers.json');
fs.writeFileSync(out, JSON.stringify({ SEC, s1, tabSel, reqs }, null, 2));
console.log('截图:', shot, '报告:', out);
cdp.close();
process.exit(0);
