/** 扫描直播广场，找带购物袋的带货直播间 */
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate('https://live.douyin.com/', { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 2000));

const cards = await cdp.evaluate(`(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="live.douyin.com/"]')) {
    const m = (a.getAttribute('href') || '').match(/live\\.douyin\\.com\\/(\\d{3,})/);
    if (!m) continue;
    const html = a.innerHTML || '';
    const txt = (a.innerText || '').replace(/\\s+/g, ' ');
    out.push({
      rid: m[1],
      score: Number((txt.match(/(\\d+)\\s*$/) || [])[1] || 0),
      hasCart: /cart|shop|goods|购物|商品|商品卡|小黄车/i.test(html),
      hasCartTxt: /购物|商品|小黄车|已售|券/i.test(txt),
      txt: txt.slice(0, 50),
    });
  }
  return [...new Map(out.map(x => [x.rid, x])).values()];
})()`);

console.log('卡片总数:', cards.length);
const shop = cards.filter((c) => c.hasCart || c.hasCartTxt);
console.log('疑似带货:', shop.length);
for (const c of shop.slice(0, 10)) console.log('  ', c.rid, c.score, c.hasCart ? '[cart]' : '', c.txt);
console.log('\n全部卡片前 10 条:');
for (const c of cards.slice(0, 10)) console.log('  ', c.rid, c.score, c.txt);

// 逐个进入疑似带货房间，确认购物袋
for (const c of shop.slice(0, 4)) {
  await cdp.navigate(`https://live.douyin.com/${c.rid}`, { waitMs: 6000 });
  await new Promise((r) => setTimeout(r, 3000));
  const probe = await cdp.evaluate(`(() => {
    const byText = (re) => [...document.querySelectorAll('div, span, button, a')].find(e => re.test((e.innerText||'').trim()) && e.getBoundingClientRect().width > 0);
    const cart = byText(/^(购物袋|商品|小黄车)$/);
    const rect = cart ? cart.getBoundingClientRect() : null;
    return {
      url: location.href.slice(0, 60),
      title: document.title.slice(0, 30),
      cartFound: !!cart,
      cartText: cart ? cart.innerText.trim() : '',
      cartRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      soldText: ((document.body.innerText || '').match(/已售[^\\n]{0,12}|券后[^\\n]{0,12}/g) || []).slice(0, 3),
    };
  })()`);
  console.log('\n[' + c.rid + ']', JSON.stringify(probe));
  if (probe.cartFound) {
    console.log('  >>> 找到带货直播间:', c.rid);
    break;
  }
}

cdp.close();
process.exit(0);
