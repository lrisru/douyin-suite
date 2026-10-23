/** 诊断视频页评论区：点击评论图标后，输入框长什么样 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const AWEME = process.argv[2] || '7648597554959109402';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate(`https://www.douyin.com/video/${AWEME}`, { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 3000));

const before = await cdp.evaluate(`(() => {
  const icon = document.querySelector('div[data-e2e="feed-comment-icon"]');
  const r = icon ? icon.getBoundingClientRect() : null;
  return {
    url: location.href.slice(0, 60),
    title: document.title.slice(0, 30),
    hasIcon: !!icon,
    iconRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    editables: [...document.querySelectorAll('[contenteditable]:not([contenteditable="false"])')].map(e => ({
      cls: (e.className || '').toString().slice(0, 50), text: (e.innerText || '').slice(0, 20),
    })),
    textareas: [...document.querySelectorAll('textarea, input[type="text"]')].map(e => ({
      tag: e.tagName, cls: (e.className || '').toString().slice(0, 40), ph: e.getAttribute('placeholder') || '',
    })),
  };
})()`);
console.log('点击前:', JSON.stringify(before, null, 1));

if (before.hasIcon) {
  await cdp.evaluate(`document.querySelector('div[data-e2e="feed-comment-icon"]').click()`);
  await new Promise((r) => setTimeout(r, 3500));

  const after = await cdp.evaluate(`(() => {
    const editables = [...document.querySelectorAll('[contenteditable]:not([contenteditable="false"])')].map(e => ({
      cls: (e.className || '').toString().slice(0, 60),
      text: (e.innerText || '').slice(0, 24),
      rect: (() => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    }));
    const textareas = [...document.querySelectorAll('textarea, input')].map(e => ({
      tag: e.tagName, cls: (e.className || '').toString().slice(0, 40), ph: e.getAttribute('placeholder') || '',
    }));
    const panels = [...new Set([...document.querySelectorAll('div[class]')].map(d => d.className.toString())
      .filter(c => /comment|Comment|editor|input/i.test(c)))].slice(0, 12);
    return {
      editables, textareas, panels,
      mergeAll: !!document.querySelector('#merge-all-comment-container'),
      bodyTail: (document.body.innerText || '').slice(-300).replace(/\\s+/g, ' '),
    };
  })()`);
  console.log('\n点击后:', JSON.stringify(after, null, 1));
  await cdp.screenshot(path.resolve('test/comment-area.png'));
  console.log('截图 test/comment-area.png');
}

cdp.close();
process.exit(0);
