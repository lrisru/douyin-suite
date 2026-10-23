/** 精细探针：dump ChatMessage / GiftMessage 每个字段的原始内容，确认字段号 */
import path from 'node:path';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { parsePushFrame, parseResponse, decode } from '../src/protobuf.js';

const port = 9347;
const profile = path.resolve('test/.probe-profile3');
import fs from 'node:fs';
fs.mkdirSync(profile, { recursive: true });

const chrome = findChrome({});
launchChrome({ chromePath: chrome, profileDir: profile, port, headless: false, width: 1100, height: 800 });
const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }

const cdp = await Cdp.connect((await newTab(port, 'https://live.douyin.com/')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 3500));

const rooms = await cdp.evaluate(`(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="live.douyin.com/"]')) {
    const m = (a.getAttribute('href') || '').match(/live\\.douyin\\.com\\/(\\d{3,})/);
    if (!m) continue;
    const txt = (a.innerText || '');
    const num = Number((txt.match(/(\\d+)\\s*$/) || [])[1] || 0);
    out.push({ rid: m[1], score: num });
  }
  return [...new Map(out.map(x => [x.rid, x])).values()].sort((a,b)=>b.score-a.score).slice(0,4).map(x=>x.rid);
})()`);

const want = process.argv.slice(2).filter((a) => /^\d{3,}$/.test(a));
const list = want.length ? want : rooms;
console.log('房间:', list);

const dump = [];
const counts = {};

const off = cdp.on('Network.webSocketFrameReceived', (p) => {
  const data = p?.response?.payloadData;
  if (!data) return;
  let frame;
  try { frame = parsePushFrame(Buffer.from(data, 'base64')); } catch { return; }
  if (!frame?.payload) return;
  let resp;
  try { resp = parseResponse(frame.payload); } catch { return; }
  for (const m of resp.messages || []) {
    counts[m.method] = (counts[m.method] || 0) + 1;
    if (!/ChatMessage|GiftMessage/.test(m.method)) continue;
    if (dump.length > 60) continue;
    const f = decode(m.payload);
    const fields = {};
    for (const [no, arr] of Object.entries(f)) {
      const v = arr[0];
      if (v.wire === 2 && v.bytes) {
        const buf = Buffer.from(v.bytes);
        const hex = buf.subarray(0, 24).toString('hex');
        const utf8 = buf.toString('utf8').replace(/[^\x20-\x7e\u4e00-\u9fff]/g, '.');
        const sub = decode(buf);
        fields[no] = { len: buf.length, hex, utf8: utf8.slice(0, 60), subKeys: Object.keys(sub) };
      } else {
        fields[no] = { varint: v.value };
      }
    }
    dump.push({ method: m.method, fields });
  }
});

for (const rid of list) {
  console.log('→', rid);
  await cdp.navigate(`https://live.douyin.com/${rid}`, { waitMs: 2500 });
  await new Promise((r) => setTimeout(r, 12000));
}

off();
const out = path.resolve('test/live-fields.json');
fs.writeFileSync(out, JSON.stringify({ counts, dump }, null, 2));
console.log('消息统计:', JSON.stringify(counts));
console.log('采样条数:', dump.length, '->', out);
cdp.close();
await new Promise((r) => setTimeout(r, 300));
try { process.kill(chrome.pid); } catch { /* ignore */ }
process.exit(0);
