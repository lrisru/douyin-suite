/** 点开私信面板后，dump 真实输入框结构 */
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
await new Promise((r) => setTimeout(r, 4500));

const info = await cdp.evaluate(`(() => {
  const editables = [...document.querySelectorAll('[contenteditable], textarea')].map(e => ({
    tag: e.tagName,
    cls: (e.className || '').toString().slice(0, 50),
    rect: (() => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    placeholder: e.getAttribute('placeholder') || e.getAttribute('data-placeholder') || '',
  })).filter(x => x.rect.w > 0);
  const panels = [...new Set([...document.querySelectorAll('div[class]')].map(d => d.className.toString())
    .filter(c => /im|chat|message|conversation|editor/i.test(c)))].slice(0, 12);
  return {
    url: location.href.slice(0, 60),
    editables,
    panels,
    tail: (document.body.innerText || '').slice(-200).replace(/\\s+/g, ' '),
  };
})()`);
console.log(JSON.stringify(info, null, 1));
await cdp.screenshot(path.resolve('test/dm-open.png'));
console.log('截图 test/dm-open.png');
cdp.close();
process.exit(0);
