/** 找直播广场的分类导航，定位"购物"频道 */
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate('https://live.douyin.com/', { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 2000));

const nav = await cdp.evaluate(`(() => {
  const items = [];
  for (const el of document.querySelectorAll('a, div, span, li')) {
    const txt = (el.innerText || '').trim();
    if (!txt || txt.length > 8) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (/^(购物|商城|电商|带货|好物|团购|本地生活|游戏|娱乐|知识|音乐|聊天|户外|颜值|舞蹈|美食|旅行|亲子|三农|汽车|房产|运动|科技|文化|生活|推荐|全部)$/.test(txt)) {
      items.push({ text: txt, tag: el.tagName, href: el.getAttribute('href') || '', cls: (el.className||'').toString().slice(0,30), x: Math.round(r.x), y: Math.round(r.y) });
    }
  }
  return [...new Map(items.map(i => [i.text, i])).values()];
})()`);
console.log('导航项:', JSON.stringify(nav, null, 1));

// 试 URL 参数
for (const u of ['https://live.douyin.com/?category=shopping', 'https://live.douyin.com/?tab=shopping', 'https://live.douyin.com/shopping']) {
  await cdp.navigate(u, { waitMs: 5000 });
  const s = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 70),
    title: document.title.slice(0, 30),
    hasCart: /购物|商品|小黄车/.test(document.body.innerText || ''),
    cards: document.querySelectorAll('a[href*="live.douyin.com/"]').length,
  }))()`);
  console.log(u, '->', JSON.stringify(s));
}

cdp.close();
process.exit(0);
