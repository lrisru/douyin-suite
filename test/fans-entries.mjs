/** 粉丝列表入口探测：试 URL 参数 / 点数字 / 点父元素 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const SEC = process.argv[3] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380rH-K8B91qq8KTo';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const log = [];
const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/aweme\/v1\/web\/user\//.test(u)) reqs.push(u.split('?')[0]);
});

const snap = async (label) => {
  const s = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 110),
    fans: !!document.querySelector('[data-e2e="user-fans-container"]'),
    modal: !!document.querySelector('[role="dialog"], [class*="modal"]'),
    links: document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]').length,
    tabs: [...document.querySelectorAll('[data-e2e*="tab"], div[role="tab"]')].map(e=>({t:(e.innerText||'').trim().slice(0,10), e2e:e.getAttribute('data-e2e')||''})).filter(x=>x.t).slice(0,8),
  }))()`);
  log.push({ label, ...s, reqs: [...new Set(reqs)] });
  console.log(`[${label}]`, JSON.stringify(s), 'reqs:', JSON.stringify([...new Set(reqs)]));
  reqs.length = 0;
  return s;
};

for (const q of ['?showTab=fans', '?showTab=followers', '?tab=fans', '?showTab=follow']) {
  await cdp.navigate(`https://www.douyin.com/user/${SEC}${q}`, { waitMs: 6000 });
  await new Promise((r) => setTimeout(r, 2000));
  await snap('url' + q);
}

// 点击粉丝数字（内部第二个 div）
await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 1500));

const clickInfo = await cdp.evaluate(`(() => {
  const box = document.querySelector('[data-e2e="user-info-fans"]');
  if (!box) return null;
  const num = box.querySelector('div:nth-child(2)') || box;
  const r = num.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2, numText: (num.innerText||'').trim() };
})()`);
console.log('\n点数字:', JSON.stringify(clickInfo));
if (clickInfo) {
  reqs.length = 0;
  await cdp.clickPoint(clickInfo.x, clickInfo.y);
  await new Promise((r) => setTimeout(r, 5000));
  await snap('click-num');
}

await cdp.screenshot(path.resolve('test/fans-modal.png'));
fs.writeFileSync(path.resolve('test/fans-entries.json'), JSON.stringify(log, null, 2));
console.log('截图 test/fans-modal.png');
cdp.close();
process.exit(0);
