/** 深度诊断私信面板：点击后的完整结构与输入入口 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const SEC = process.argv[2] || 'MS4wLjABAAAASdj-lTLpDQSX-njVcOagPMbJOpVADwsV0atyoOLZaP8';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 2500));

const clicked = await cdp.evaluate(`(() => {
  const cands = [...document.querySelectorAll('button, [role="button"], span')]
    .filter(x => /^(私信|发消息)$/.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0);
  if (!cands.length) return false;
  cands[cands.length - 1].click();
  return true;
})()`);
console.log('点击私信:', clicked);
await new Promise((r) => setTimeout(r, 6000));

const info = await cdp.evaluate(`(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const editables = [...document.querySelectorAll('[contenteditable], textarea, input[type="text"]')]
    .map(e => ({
      tag: e.tagName,
      cls: (e.className || '').toString().slice(0, 50),
      visible: vis(e),
      ph: e.getAttribute('placeholder') || e.getAttribute('data-placeholder') || '',
      rect: (() => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
    }));
  const btns = [...document.querySelectorAll('button, [role="button"]')]
    .filter(vis).map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 20);
  const im = document.querySelector('[class*="imContainer"]');
  return {
    editables,
    btns,
    imText: im ? (im.innerText || '').slice(0, 300).replace(/\\s+/g, ' ') : '(没有 imContainer)',
    imHtmlHead: im ? im.innerHTML.slice(0, 400) : '',
  };
})()`);
console.log(JSON.stringify(info, null, 1));

await cdp.screenshot(path.resolve('test/dm-deep.png'));
console.log('截图 test/dm-deep.png');
cdp.close();
process.exit(0);
