/** 点私信后截图，看页面真实反应 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const SEC = process.argv[2] || 'MS4wLjABAAAA_SOME_USER_SEC_UID';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 3000));

const clicked = await cdp.evaluate(`(() => {
  const cands = [...document.querySelectorAll('button, [role="button"], span')]
    .filter(x => /^(私信|发消息)$/.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0);
  if (!cands.length) return { ok: false, n: 0 };
  const el = cands[cands.length - 1];
  const r = el.getBoundingClientRect();
  el.click();
  return { ok: true, n: cands.length, tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) } };
})()`);
console.log('点击:', JSON.stringify(clicked));
await new Promise((r) => setTimeout(r, 5000));

const info = await cdp.evaluate(`(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const toasts = [...document.querySelectorAll('[class*="toast"], [class*="Toast"], [class*="tip"], [class*="Tip"], [class*="dialog"], [class*="Dialog"], [class*="modal"]')]
    .filter(vis).map(e => (e.innerText || '').trim().replace(/\\s+/g, ' ')).filter(t => t && t.length < 120);
  return {
    url: location.href.slice(0, 60),
    hasIm: !!document.querySelector('[class*="imContainer"]'),
    toasts: [...new Set(toasts)].slice(0, 5),
    tail: (document.body.innerText || '').slice(-200).replace(/\\s+/g, ' '),
  };
})()`);
console.log(JSON.stringify(info, null, 1));

await cdp.screenshot(path.resolve('test/dm-after-click.png'));
console.log('截图 test/dm-after-click.png');
cdp.close();
process.exit(0);
