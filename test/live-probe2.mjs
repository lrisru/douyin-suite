/**
 * 多直播间弹幕探针：依次进 3 个房间各 15 秒，累计消息类型与字段结构。
 * 用法：node test/live-probe2.mjs [rid1] [rid2] ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { parsePushFrame, parseResponse, decode, extractStrings } from '../src/protobuf.js';

const port = 9346;
const profile = path.resolve('test/.probe-profile2');
fs.mkdirSync(profile, { recursive: true });

const chrome = findChrome({});
if (!chrome) { console.error('no chrome'); process.exit(1); }
launchChrome({ chromePath: chrome, profileDir: profile, port, headless: false, width: 1280, height: 860 });

const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }

const t = await newTab(port, 'https://live.douyin.com/');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 4000));

let rooms = process.argv.slice(2).filter((a) => /^\d{3,}$/.test(a));
if (!rooms.length) {
  rooms = await cdp.evaluate(`(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="live.douyin.com/"]')) {
      const m = (a.getAttribute('href') || '').match(/live\\.douyin\\.com\\/(\\d{3,})/);
      if (!m) continue;
      const txt = (a.innerText || '');
      const num = Number((txt.match(/(\\d+)\\s*$/) || [])[1] || 0);
      out.push({ rid: m[1], score: num });
    }
    return [...new Map(out.map(x => [x.rid, x])).values()].sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.rid);
  })()`);
}
console.log('探测房间:', rooms);

const stats = { byMethod: {}, samples: {}, rooms: {} };
let currentRoom = '';

const off = cdp.on('Network.webSocketFrameReceived', (p) => {
  const data = p?.response?.payloadData;
  if (!data) return;
  let frame;
  try { frame = parsePushFrame(Buffer.from(data, 'base64')); } catch { return; }
  if (!frame?.payload) return;
  let resp;
  try { resp = parseResponse(frame.payload); } catch { return; }
  for (const m of resp.messages || []) {
    stats.byMethod[m.method] = (stats.byMethod[m.method] || 0) + 1;
    stats.rooms[currentRoom] = (stats.rooms[currentRoom] || 0) + 1;
    if (!stats.samples[m.method] && m.payload) {
      const f = decode(m.payload);
      const shape = {};
      for (const [no, arr] of Object.entries(f)) {
        const first = arr[0];
        if (first.wire === 2 && first.bytes) {
          const sub = decode(first.bytes);
          const keys = Object.keys(sub);
          if (keys.length) {
            shape[no] = `msg{${keys.slice(0, 8).map((k) => {
              const v = sub[k][0];
              if (v.wire === 2) {
                try {
                  const s = Buffer.from(v.bytes).toString('utf8');
                  if (/^[\x20-\x7e\u4e00-\u9fff]{2,30}$/.test(s)) return `${k}:"${s}"`;
                } catch { /* ignore */ }
                return `${k}:bin`;
              }
              return `${k}:${v.value}`;
            }).join(',')}}`;
          } else shape[no] = 'msg{empty}';
        } else {
          shape[no] = String(first.value ?? '');
        }
      }
      stats.samples[m.method] = { shape, strings: extractStrings(m.payload).slice(0, 10) };
    }
  }
});

for (const rid of rooms) {
  currentRoom = rid;
  console.log(`\n→ 进入 ${rid}`);
  await cdp.navigate(`https://live.douyin.com/${rid}`, { waitMs: 3000 });
  await new Promise((r) => setTimeout(r, 15000));
  const t2 = await cdp.evaluate('document.title');
  console.log(`   ${t2}`);
}

off();
const out = path.resolve('test/live-probe2.json');
fs.writeFileSync(out, JSON.stringify(stats, null, 2));
console.log('\n类型分布:', JSON.stringify(stats.byMethod, null, 1));
console.log('房间命中:', JSON.stringify(stats.rooms));
console.log('采样:', out);
cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
process.exit(0);
