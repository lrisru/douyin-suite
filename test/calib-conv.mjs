/** 私信会话入口标定：试不同 URL 与点“消息”图标，抓 imapi 请求 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/imapi\.douyin|conversation|im\/|message/.test(u)) reqs.push(u.split('?')[0]);
});

const shots = [];
const snap = async (label) => {
  const s = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 100),
    title: document.title,
    hasList: !!document.querySelector('[class*="conversation"], [data-e2e*="conversation"]'),
    textHead: ((document.body.innerText || '').slice(0, 100)).replace(/\\s+/g, ' '),
  }))()`);
  console.log(`[${label}]`, JSON.stringify(s), 'reqs:', JSON.stringify([...new Set(reqs)]));
  reqs.length = 0;
  return s;
};

for (const u of ['https://www.douyin.com/message', 'https://www.douyin.com/user/self?showTab=message', 'https://www.douyin.com/user/self?showTab=chat']) {
  await cdp.navigate(u, { waitMs: 6000 });
  await new Promise((r) => setTimeout(r, 2500));
  await snap(u.replace('https://www.douyin.com', ''));
}

// 点右上角“消息”图标
await cdp.navigate('https://www.douyin.com/jingxuan', { waitMs: 5000 });
const msgBtn = await cdp.evaluate(`(() => {
  const cands = [...document.querySelectorAll('div, span, a, button')];
  const hit = cands.find(e => (e.innerText || '').trim() === '消息' && e.getBoundingClientRect().width > 0);
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2, tag: hit.tagName, cls: (hit.className||'').toString().slice(0,40) };
})()`);
console.log('\n消息按钮:', JSON.stringify(msgBtn));
if (msgBtn) {
  await cdp.clickPoint(msgBtn.x, msgBtn.y);
  await new Promise((r) => setTimeout(r, 6000));
  await snap('click-消息');
  await cdp.screenshot(path.resolve('test/conversations.png'));
  shots.push('test/conversations.png');
}

fs.writeFileSync(path.resolve('test/calib-conv.json'), JSON.stringify({ msgBtn, shots }, null, 2));
console.log('截图:', shots.join(','));
cdp.close();
process.exit(0);
