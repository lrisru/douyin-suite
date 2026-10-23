/** 诊断：登录态下用户页是否正常加载，取自己的 sec_uid 与 tab 结构 */
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/aweme\/v1\/web\/(user|im)|imapi/.test(u)) reqs.push(u.split('?')[0]);
});

await cdp.navigate('https://www.douyin.com/user/self', { waitMs: 8000 });

const s1 = await cdp.evaluate(`(() => ({
  url: location.href,
  title: document.title,
  tabs: [...document.querySelectorAll('div[role="tab"], span, a')]
    .map(e => (e.innerText || '').trim())
    .filter(t => /^(作品|粉丝|关注|喜欢|收藏)$/.test(t))
    .slice(0, 10),
  userInfo: !!document.querySelector('div[data-e2e="user-info"]'),
  textHead: ((document.body.innerText || '').slice(0, 160)).replace(/\\s+/g, ' '),
}))()`);

console.log('[user/self]', JSON.stringify(s1, null, 1));
console.log('requests:', JSON.stringify([...new Set(reqs)]));

reqs.length = 0;
await new Promise((r) => setTimeout(r, 4000));
console.log('after wait:', JSON.stringify([...new Set(reqs)]));

// 页面结构：找 tab 容器
const struct = await cdp.evaluate(`(() => {
  const out = [];
  for (const sel of ['div[role="tab"]', '#semiTabUser', 'div[data-e2e="user-tab"]', 'ul[role="tablist"] li', 'div[class*="tab"]']) {
    const els = [...document.querySelectorAll(sel)].slice(0, 6).map(e => (e.innerText || '').trim().slice(0, 12));
    if (els.length) out.push({ sel, els });
  }
  return out;
})()`);
console.log('tab 结构:', JSON.stringify(struct, null, 1));

cdp.close();
process.exit(0);
