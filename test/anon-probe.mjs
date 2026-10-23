/**
 * 未登录可用性探测：直播间 → 主播主页 → 作品列表 → 解析 → 下载
 * 用来判断哪些采集入口不需要登录态。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, ResponseCollector, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { DouyinService } from '../src/douyin.js';
import { loadConfig, sleep } from '../src/util.js';

const cfg = loadConfig(process.cwd());
const port = 9350;
const profile = path.resolve('test/.probe-profile6');
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: false, width: 1100, height: 800 });
const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();

// 1. 进直播间拿主播 sec_uid
await cdp.navigate('https://live.douyin.com/1423473628', { waitMs: 5000 });
const secUid = await cdp.evaluate(`(() => {
  for (const a of document.querySelectorAll('a[href*="/user/"]')) {
    const m = (a.getAttribute('href') || '').match(/\\/user\\/(MS4wLjAB[\\w-]+)/);
    if (m) return m[1];
  }
  return '';
})()`);
console.log('主播 sec_uid:', secUid || '(未取到)');

// 2. 打开主播主页，抓作品接口
let awemeId = '';
if (secUid) {
  await cdp.navigate(`https://www.douyin.com/user/${secUid}`, { waitMs: 5000 });
  const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\/(aweme\/post|user\/profile)/]);
  await sleep(7000);
  collector.stop();
  for (const it of collector.items) {
    const list = it.json?.aweme_list || it.json?.data || [];
    for (const a of list) {
      const id = a?.aweme_id || a?.aweme_info?.aweme_id;
      if (id) { awemeId = String(id); break; }
    }
    if (awemeId) break;
  }
  console.log('抓到响应:', collector.items.length, '作品 ID:', awemeId || '(未取到)');
}

// 3. 解析 + 下载
const douyin = new DouyinService({ page: async () => ({ cdp }) }, cfg);
if (awemeId) {
  const info = await douyin.resolveShare(`https://www.douyin.com/video/${awemeId}`);
  console.log('解析:', JSON.stringify({ ok: info.ok, desc: (info.desc || '').slice(0, 24), hasVideo: !!info.video, source: info.source, reason: info.reason }));
  if (info.ok && info.video) {
    const r = await douyin.download({ awemeIds: [awemeId] });
    console.log('下载目录:', r.dir);
    console.log('结果:', JSON.stringify(r.results.map((x) => ({ ok: x.ok, files: x.files?.map((f) => `${path.basename(f.file)}:${f.size}`) }))));
  }
} else {
  console.log('结论：未登录拿不到作品列表，下载链路需登录后验证');
}

cdp.close();
await sleep(300);
try { process.kill(chrome.pid); } catch { /* ignore */ }
process.exit(0);
