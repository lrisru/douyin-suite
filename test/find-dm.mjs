/** 精确查找用户页的"私信"元素 */
import { Cdp, listTargets } from '../src/cdp.js';

const SEC = process.argv[2] || 'MS4wLjABAAAASdj-lTLpDQSX-njVcOagPMbJOpVADwsV0atyoOLZaP8';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 2500));

const hits = await cdp.evaluate(`(() => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const txt = (el.innerText || '').trim();
    if (txt !== '私信' && txt !== '发消息') continue;
    const r = el.getBoundingClientRect();
    out.push({
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 60),
      e2e: el.getAttribute('data-e2e') || '',
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      html: el.outerHTML.slice(0, 160),
    });
  }
  return out.slice(0, 6);
})()`);
console.log('找到私信元素:', hits.length);
console.log(JSON.stringify(hits, null, 1));

// 尝试点击最内层的那个
const target = hits.find((h) => h.rect.w > 0);
if (target) {
  await cdp.clickPoint(target.rect.x + target.rect.w / 2, target.rect.y + target.rect.h / 2);
  await new Promise((r) => setTimeout(r, 3500));
  const after = await cdp.evaluate(`(() => ({
    panel: !!document.querySelector('[data-e2e="msg-input"], [class*="messageEditor"], [class*="imChat"]'),
    editables: [...document.querySelectorAll('[contenteditable]')].length,
    text: (document.body.innerText || '').slice(-160).replace(/\\s+/g, ' '),
  }))()`);
  console.log('\n点击后:', JSON.stringify(after, null, 1));
  await cdp.screenshot('test/dm-panel.png');
  console.log('截图 test/dm-panel.png');
}

cdp.close();
process.exit(0);
