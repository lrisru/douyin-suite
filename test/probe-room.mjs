/**
 * 探测指定直播间：是否在播、购物袋、商品、以及弹幕里的购买类消息
 * 用法：node test/probe-room.mjs <web_rid> [秒]
 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, ResponseCollector, listTargets } from '../src/cdp.js';
import { parsePushFrame, parseResponse, decode, extractStrings } from '../src/protobuf.js';

const PORT = 9301;
const RID = process.argv[2] || '324127181125';
const SECS = Number(process.argv[3] || 25);

const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const methods = {};
const shopping = [];
const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/product|goods|order|commerce|cart|promo|shop|trade/i.test(u) && !/\.js|\.css/.test(u)) reqs.push(u.split('?')[0]);
});
cdp.on('Network.webSocketFrameReceived', (p) => {
  const d = p?.response?.payloadData;
  if (!d) return;
  try {
    const f = parsePushFrame(Buffer.from(d, 'base64'));
    if (!f?.payload) return;
    const r = parseResponse(f.payload);
    for (const m of r.messages || []) {
      methods[m.method] = (methods[m.method] || 0) + 1;
      if (/Shopping|Commerce|Purchase|Order|Cart|Product|Trade/i.test(m.method)) {
        const flds = m.payload ? decode(m.payload) : {};
        shopping.push({
          method: m.method,
          strings: extractStrings(m.payload || Buffer.alloc(0)).slice(0, 10),
          fields: Object.keys(flds),
        });
      }
    }
  } catch { /* ignore */ }
});

await cdp.navigate(`https://live.douyin.com/${RID}`, { waitMs: 8000 });
await new Promise((r) => setTimeout(r, 2000));

const info = await cdp.evaluate(`(() => {
  const txt = document.body.innerText || '';
  const byText = (re) => [...document.querySelectorAll('div, span, button, a')].find(e => re.test((e.innerText||'').trim()) && e.getBoundingClientRect().width > 0);
  const cart = byText(/^(购物袋|商品|小黄车|商品卡)$/);
  const r = cart ? cart.getBoundingClientRect() : null;
  return {
    url: location.href.slice(0, 70),
    title: document.title.slice(0, 40),
    ended: /直播已结束|已下播/.test(txt),
    cart: cart ? cart.innerText.trim() : '',
    cartRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    sold: (txt.match(/已售[^\\n]{0,10}|售出[^\\n]{0,10}|券后[^\\n]{0,14}/g) || []).slice(0, 5),
    tip: (txt.match(/[^\\n]{0,12}(购买|下单|拍下)[^\\n]{0,12}/g) || []).slice(0, 5),
    tail: txt.slice(-200).replace(/\\s+/g, ' '),
  };
})()`);
console.log('页面:', JSON.stringify(info, null, 1));

// 点开购物袋
if (info.cartRect) {
  console.log('\n点击购物袋…');
  await cdp.clickPoint(info.cartRect.x + info.cartRect.w / 2, info.cartRect.y + info.cartRect.h / 2);
  await new Promise((r) => setTimeout(r, 4000));
  const shop = await cdp.evaluate(`(() => {
    const boxes = [...document.querySelectorAll('div[class]')].filter(d => /product|goods|shop|sku|card/i.test(d.className.toString()) && (d.innerText || '').length > 10);
    return {
      boxes: boxes.slice(0, 4).map(b => ({ cls: b.className.toString().slice(0, 50), text: (b.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) })),
      bodyText: (document.body.innerText || '').slice(-500).replace(/\\s+/g, ' '),
    };
  })()`);
  console.log('商品区:', JSON.stringify(shop, null, 1));
  await cdp.screenshot(path.resolve('test/room-shop.png'));
  console.log('截图 test/room-shop.png');
}

console.log('\n等待弹幕', SECS, '秒…');
await new Promise((r) => setTimeout(r, SECS * 1000));

console.log('\n消息类型分布:');
for (const [k, v] of Object.entries(methods).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log('  ', k, v);

console.log('\n购买类消息:', JSON.stringify(shopping.slice(0, 10), null, 1));
console.log('\n商品相关请求:', JSON.stringify([...new Set(reqs)].slice(0, 10), null, 1));

fs.writeFileSync(path.resolve('test/room-probe.json'), JSON.stringify({ RID, info, methods, shopping, reqs: [...new Set(reqs)] }, null, 2));
console.log('\n报告 test/room-probe.json');
cdp.close();
process.exit(0);
