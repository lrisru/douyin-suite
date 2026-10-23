/**
 * 真实直播间弹幕帧探针：不需要登录，打开 live.douyin.com 抓 WebSocket 帧，
 * 统计 method 分布 + dump 每种消息的 protobuf 字段结构，用于校准 parseWebcastMessage。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { parsePushFrame, parseResponse, decode, extractStrings } from '../src/protobuf.js';

const port = 9345;
const profile = path.resolve('test/.probe-profile');
fs.mkdirSync(profile, { recursive: true });
fs.rmSync(path.join(profile, 'SingletonLock'), { force: true });

const chrome = findChrome({});
if (!chrome) { console.error('no chrome'); process.exit(1); }
launchChrome({ chromePath: chrome, profileDir: profile, port, headless: process.argv.includes('--head'), width: 1280, height: 860 });

const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }

const t = await newTab(port, 'https://live.douyin.com/');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 4000));

const title = await cdp.evaluate('document.title');
console.log('首页:', title);

// 从首页找直播间链接
const rooms = await cdp.evaluate(`(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="live.douyin.com/"]')) {
    const m = (a.getAttribute('href') || '').match(/live\\.douyin\\.com\\/(\\d{3,})/);
    if (m) out.push({ rid: m[1], text: (a.innerText || '').trim().slice(0, 30) });
  }
  const uniq = [...new Map(out.map(x => [x.rid, x])).values()];
  return uniq.slice(0, 8);
})()`);
console.log('页面上的直播间:', JSON.stringify(rooms));

const rid = process.argv.find((a) => /^\d{3,}$/.test(a)) || rooms[0]?.rid;
if (!rid) { console.error('没找到直播间'); process.exit(1); }
console.log('进入直播间:', rid);

const stats = { frames: 0, wsFrames: 0, byMethod: {}, samples: {} };
const off = cdp.on('Network.webSocketFrameReceived', (p) => {
  const data = p?.response?.payloadData;
  if (!data) return;
  stats.wsFrames++;
  let buf;
  try { buf = Buffer.from(data, 'base64'); } catch { return; }
  let frame;
  try { frame = parsePushFrame(buf); } catch { return; }
  if (!frame?.payload) return;
  let resp;
  try { resp = parseResponse(frame.payload); } catch { return; }
  if (!resp?.messages?.length) return;
  stats.frames++;
  for (const m of resp.messages) {
    stats.byMethod[m.method] = (stats.byMethod[m.method] || 0) + 1;
    if (!stats.samples[m.method] && m.payload) {
      const f = decode(m.payload);
      const shape = {};
      for (const [no, arr] of Object.entries(f)) {
        const first = arr[0];
        if (first.wire === 2 && first.bytes) {
          const sub = decode(first.bytes);
          const subKeys = Object.keys(sub);
          const subText = subKeys.length && subKeys.length < 12
            ? subKeys.map((k) => {
              const v = sub[k][0];
              if (v.wire === 2) {
                try {
                  const s = Buffer.from(v.bytes).toString('utf8');
                  if (/^[\x20-\x7e\u4e00-\u9fff]{2,40}$/.test(s)) return `${k}:"${s}"`;
                } catch { /* ignore */ }
                return `${k}:msg`;
              }
              return `${k}:${v.value}`;
            }).join(', ')
            : '';
          shape[no] = `msg{${subText}}`;
        } else {
          shape[no] = `${first.value ?? ''}`;
        }
      }
      stats.samples[m.method] = {
        shape,
        strings: extractStrings(m.payload).slice(0, 8),
      };
    }
  }
});

await cdp.navigate(`https://live.douyin.com/${rid}`, { waitMs: 4000 });
console.log('等待弹幕帧 25 秒…');
await new Promise((r) => setTimeout(r, 25000));

off();
const outFile = path.resolve('test/live-probe.json');
fs.writeFileSync(outFile, JSON.stringify({ rid, title: await cdp.evaluate('document.title'), stats }, null, 2));

console.log('ws 帧总数:', stats.wsFrames, ' 解析出的响应:', stats.frames);
console.log('消息类型分布:', JSON.stringify(stats.byMethod, null, 1));
console.log('采样文件:', outFile);
cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
process.exit(0);
