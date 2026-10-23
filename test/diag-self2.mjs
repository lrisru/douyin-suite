/** 诊断：从左侧导航进入“我的”，看能否加载个人主页并拿到 sec_uid */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate('https://www.douyin.com/jingxuan', { waitMs: 5000 });

const mine = await cdp.evaluate(`(() => {
  const els = [...document.querySelectorAll('a, div, span, li')];
  const el = els.find(x => (x.innerText || '').trim() === '我的');
  if (!el) return { ok: false };
  el.click();
  return { ok: true, tag: el.tagName, href: el.getAttribute('href') || '' };
})()`);
console.log('点击「我的」:', JSON.stringify(mine));

await new Promise((r) => setTimeout(r, 8000));
const s1 = await cdp.evaluate(`(() => ({
  url: location.href,
  title: document.title,
  secUid: (location.href.match(/\\/user\\/(MS4wLjAB[\\w-]+)/) || [])[1] || '',
  hasUserInfo: !!document.querySelector('div[data-e2e="user-info"]'),
  tabs: [...document.querySelectorAll('div[role="tab"], span, a')]
    .map(e => (e.innerText || '').trim())
    .filter(t => /^(作品|粉丝|关注|喜欢|收藏)$/.test(t)).slice(0, 10),
  textHead: ((document.body.innerText || '').slice(0, 140)).replace(/\\s+/g, ' '),
}))()`);
console.log('个人页状态:', JSON.stringify(s1, null, 1));

if (s1.secUid) {
  // 打开自己的粉丝页
  await cdp.navigate(`https://www.douyin.com/user/${s1.secUid}?showTab=followers`, { waitMs: 8000 });
  const reqs = [];
  const off = cdp.on('Network.requestWillBeSent', (p) => {
    const u = p.request?.url || '';
    if (/follower\/list|following\/list|user\/relation/.test(u)) reqs.push(u.split('?')[0]);
  });
  await new Promise((r) => setTimeout(r, 5000));
  off();
  const s2 = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 100),
    title: document.title,
    hasFans: !!document.querySelector('[data-e2e="user-fans-container"]'),
    items: document.querySelectorAll('[data-e2e="user-fans-container"] div[class*="user"], div[data-e2e="user-info"]').length,
    tabs: [...document.querySelectorAll('div[role="tab"], span, a')]
      .map(e => (e.innerText || '').trim())
      .filter(t => /^(作品|粉丝|关注)$/.test(t)).slice(0, 6),
  }))()`);
  console.log('粉丝页状态:', JSON.stringify(s2, null, 1));
  console.log('粉丝相关请求:', JSON.stringify([...new Set(reqs)]));
}

const shot = path.resolve('test/self-page.png');
await cdp.screenshot(shot);
console.log('截图:', shot);
cdp.close();
process.exit(0);
