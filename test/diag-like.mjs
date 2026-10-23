/** 诊断点赞按钮：点击前后的完整状态变化 */
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const AWEME = process.argv[2] || '7689079605591887144';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate(`https://www.douyin.com/video/${AWEME}`, { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 3000));

const read = async (label) => {
  const s = await cdp.evaluate(`(() => {
    const d = document.querySelector('div[data-e2e="video-player-digg"]');
    if (!d) return { found: false };
    const r = d.getBoundingClientRect();
    return {
      found: true,
      state: d.getAttribute('data-e2e-state'),
      ariaPressed: d.getAttribute('aria-pressed'),
      cls: (d.className || '').toString().slice(0, 60),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      html: d.outerHTML.slice(0, 200),
    };
  })()`);
  console.log(`[${label}]`, JSON.stringify(s));
  return s;
};

const before = await read('点击前');

// 用 CDP 鼠标点击中心点
if (before.found && before.rect.w > 0) {
  const x = before.rect.x + before.rect.w / 2;
  const y = before.rect.y + before.rect.h / 2;
  await cdp.clickPoint(x, y);
  console.log('点击坐标:', x, y);
  await new Promise((r) => setTimeout(r, 2500));
  await read('点击后 2.5s');

  // 再点一次（还原）
  await cdp.clickPoint(x, y);
  await new Promise((r) => setTimeout(r, 2500));
  await read('再点一次后');
}

cdp.close();
process.exit(0);
