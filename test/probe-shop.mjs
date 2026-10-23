/** 探测带货直播间：购物袋、商品销量、购买提示弹幕 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, ResponseCollector, listTargets } from '../src/cdp.js';
import { parsePushFrame, parseResponse, parseWebcastMessage, extractStrings } from '../src/protobuf.js';

const PORT = 9301;
const RID = process.argv[2] || '';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
if (!t) { console.error('no page'); process.exit(1); }
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

let rid = RID;
if (!rid) {
  await cdp.navigate('https://live.douyin.com/', { waitMs: 6000 });
  const rooms = await cdp.evaluate(`(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="live.douyin.com/"]')) {
      const m = (a.getAttribute('href') || '').match(/live\\.douyin\\.com\\/(\\d{3,})/);
      if (!m) continue;
      const txt = (a.innerText || '').replace(/\\s+/g, ' ');
      const score = Number((txt.match(/(\\d+)\\s*$/) || [])[1] || 0);
      out.push({ rid: m[1], score, txt: txt.slice(0, 40) });
    }
    return [...new Map(out.map(x => [x.rid, x])).values()].sort((a, b) => b.score - a.score).slice(0, 12);
  })()`);
  console.log('候选直播间:');
  for (const r of rooms) console.log('  ', r.rid, r.score, r.txt);
  // 优先选标题像带货的
  const shop = rooms.find((r) => /破价|开炸|上新|买|购|福利|秒杀|券|sku/i.test(r.txt)) || rooms[0];
  rid = shop?.rid;
}
console.log('\n进入:', rid);
if (!rid) process.exit(1);

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/product|shop|goods|order|commerce|cart|promo|luckycat/i.test(u)) reqs.push(u.split('?')[0]);
});

const collector = new ResponseCollector(cdp, [/webcast\/im\/push|webcast\/room\/web\/enter|product|goods/]);
const wsMsgs = [];
cdp.on('Network.webSocketFrameReceived', (p) => {
  const data = p?.response?.payloadData;
  if (!data) return;
  try {
    const frame = parsePushFrame(Buffer.from(data, 'base64'));
    if (!frame?.payload) return;
    const resp = parseResponse(frame.payload);
    for (const m of resp.messages || []) {
      if (/Gift|Commerce|Product|Order|Shopping|Cart|Purchase/i.test(m.method)) {
        wsMsgs.push({ method: m.method, strings: extractStrings(m.payload || Buffer.alloc(0)).slice(0, 6) });
      }
    }
  } catch { /* ignore */ }
});

await cdp.navigate(`https://live.douyin.com/${rid}`, { waitMs: 8000 });
await new Promise((r) => setTimeout(r, 8000));

console.log('\n商品/订单相关请求:');
for (const u of [...new Set(reqs)].slice(0, 20)) console.log('  ', u);

const dom = await cdp.evaluate(`(() => {
  const pick = (sel) => { const e = document.querySelector(sel); return e ? (e.innerText || '').trim().slice(0, 120) : null; };
  return {
    url: location.href.slice(0, 80),
    title: document.title,
    cartBtn: pick('[data-e2e*="cart"], [class*="cart"], [class*="shop"]'),
    shopEls: [...new Set([...document.querySelectorAll('div[class]')].map(d => d.className.toString()).filter(c => /cart|shop|product|goods|commerce/i.test(c)))].slice(0, 10),
    bodyTail: ((document.body.innerText || '').slice(-400)).replace(/\\s+/g, ' '),
  };
})()`);
console.log('\nDOM:', JSON.stringify(dom, null, 1));

console.log('\nWebSocket 中的电商类消息:', JSON.stringify(wsMsgs.slice(0, 8), null, 1));

const shot = path.resolve('test/shop-probe.png');
await cdp.screenshot(shot);
fs.writeFileSync(path.resolve('test/shop-probe.json'), JSON.stringify({ rid, reqs: [...new Set(reqs)], dom, wsMsgs }, null, 2));
console.log('\n截图:', shot);
cdp.close();
process.exit(0);
