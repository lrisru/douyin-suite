/**
 * 下载链路验证：从精选页拿一个公开作品 → 解析 → 落盘。
 * 用法：node test/download.mjs [aweme_id]
 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { ResponseCollector } from '../src/cdp.js';
import { DouyinService } from '../src/douyin.js';
import { loadConfig, sleep } from '../src/util.js';

const cfg = loadConfig(process.cwd());
const port = 9349;
const profile = path.resolve('test/.probe-profile5');
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: false, width: 1100, height: 800 });
const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }

const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();

let awemeId = process.argv[2] || '';
if (!awemeId) {
  console.log('打开精选页找作品…');
  await cdp.navigate('https://www.douyin.com/jingxuan', { waitMs: 5000 });
  const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\/(aweme|feed|module)/]);
  await sleep(6000);
  collector.stop();
  for (const it of collector.items) {
    const list = it.json?.aweme_list || it.json?.data || [];
    for (const a of list) {
      const id = a?.aweme_id || a?.aweme_info?.aweme_id;
      if (id) { awemeId = String(id); break; }
    }
    if (awemeId) break;
  }
}
console.log('作品 ID:', awemeId || '(未取到)');

const douyin = new DouyinService({ page: async () => ({ cdp }) }, cfg);

if (awemeId) {
  const info = await douyin.resolveShare(`https://www.douyin.com/video/${awemeId}`);
  console.log('解析结果:', JSON.stringify({
    ok: info.ok, desc: (info.desc || '').slice(0, 30), author: info.author,
    hasVideo: !!info.video, images: info.images?.length || 0, source: info.source,
  }));
  if (info.ok && (info.video || info.images?.length)) {
    const r = await douyin.download({ awemeIds: [awemeId] });
    console.log('下载目录:', r.dir);
    for (const x of r.results) {
      console.log('  ->', x.ok ? 'OK' : 'FAIL', x.files?.map((f) => `${path.basename(f.file)}(${f.size}B)`).join(', ') || x.reason);
    }
    const files = fs.existsSync(r.dir) ? fs.readdirSync(r.dir).filter((f) => f.startsWith(awemeId)) : [];
    console.log('落盘文件:', files.join(', ') || '(无)');
  }
} else {
  console.log('跳过下载：未取到作品 ID（可能需要登录态）');
}

cdp.close();
await sleep(300);
try { process.kill(chrome.pid); } catch { /* ignore */ }
process.exit(0);
