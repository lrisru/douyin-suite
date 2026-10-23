/** 找视频页评论区的滚动容器 */
import { Cdp, listTargets } from '../src/cdp.js';

const AWEME = process.argv[2] || '7651547444441877775';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
if (!t) { console.log('浏览器没开'); process.exit(1); }
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate(`https://www.douyin.com/video/${AWEME}`, { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 3000));

// 打开评论区
await cdp.evaluate(`(() => {
  const ic = document.querySelector('div[data-e2e="feed-comment-icon"]');
  if (ic) ic.click();
})()`);
await new Promise((r) => setTimeout(r, 3000));

const info = await cdp.evaluate(`(() => {
  const cands = [];
  for (const el of document.querySelectorAll('div, ul, section')) {
    const st = getComputedStyle(el);
    const scrollable = /(auto|scroll)/.test(st.overflowY);
    if (!scrollable) continue;
    const over = el.scrollHeight - el.clientHeight;
    if (over < 50) continue;
    cands.push({
      cls: (el.className || '').toString().slice(0, 60),
      over,
      h: Math.round(el.getBoundingClientRect().height),
      items: el.querySelectorAll('[class*="comment-item"]').length,
    });
  }
  return {
    scrollable: cands.slice(0, 8),
    commentItems: document.querySelectorAll('[class*="comment-item"]').length,
    bodyText: (document.body.innerText || '').includes('条评论'),
  };
})()`);
console.log(JSON.stringify(info, null, 1));

// 试滚动最大的容器
const before = await cdp.evaluate(`document.querySelectorAll('[class*="comment-item"]').length`);
await cdp.evaluate(`(() => {
  let best = null;
  for (const el of document.querySelectorAll('div, ul, section')) {
    const st = getComputedStyle(el);
    if (!/(auto|scroll)/.test(st.overflowY)) continue;
    const over = el.scrollHeight - el.clientHeight;
    if (over < 50) continue;
    if (!best || over > best.over) best = { el, over };
  }
  if (best) { best.el.scrollTop = best.el.scrollHeight; return true; }
  return false;
})()`);
await new Promise((r) => setTimeout(r, 2500));
const after = await cdp.evaluate(`document.querySelectorAll('[class*="comment-item"]').length`);
console.log(`\n滚动前后评论条目: ${before} -> ${after}`);

cdp.close();
process.exit(0);
