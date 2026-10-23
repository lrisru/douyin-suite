/**
 * 端到端：真实直播间 → LiveStream 旁路抓帧 → 入库。
 * 不需要登录。用法：node test/live-e2e.mjs <web_rid> [秒数]
 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { LiveStream } from '../src/live.js';
import { initDb, queryLiveMessages, getDb } from '../src/db.js';
import { loadConfig, sleep } from '../src/util.js';

const rid = process.argv[2] || '1423473628';
const seconds = Number(process.argv[3] || 25);
const port = 9348;
const profile = path.resolve('test/.probe-profile4');
fs.mkdirSync(profile, { recursive: true });

const cfg = loadConfig(process.cwd());
initDb(cfg);

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: false, width: 1100, height: 800 });
const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }

const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();

const fakeHost = {
  page: async (acc, url) => {
    if (url) await cdp.navigate(url, { waitMs: 4000 });
    return { cdp };
  },
};

const seen = [];
const stream = new LiveStream({
  host: fakeHost,
  account: { id: 99 },
  webRid: rid,
  onMessage: (m) => seen.push(`${m.type}:${m.user_name}:${(m.content || '').slice(0, 30)}`),
});

console.log(`打开直播间 ${rid}，监听 ${seconds} 秒…`);
await stream.start();
await sleep(seconds * 1000);
const snap = stream.stop();

const rows = queryLiveMessages({ web_rid: rid, limit: 500 });
const byType = {};
for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;

console.log('快照:', JSON.stringify(snap.stats));
console.log('入库条数:', rows.length, JSON.stringify(byType));
console.log('样例:');
for (const r of rows.slice(0, 10)) console.log(' -', r.type, '|', r.user_name, '|', (r.content || '').slice(0, 40));

getDb().prepare('DELETE FROM live_messages WHERE web_rid = ?').run(rid);
cdp.close();
await sleep(300);
try { process.kill(chrome.pid); } catch { /* ignore */ }
process.exit(rows.length > 0 ? 0 : 1);
