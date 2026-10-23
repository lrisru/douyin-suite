/**
 * 图集（图文作品）下载验证：从真实用户主页找一条 images 非空的作品，下载全部图片。
 * 不需要登录（作品详情接口游客可用）。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, ResponseCollector, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { DouyinService } from '../src/douyin.js';
import { loadConfig, sleep } from '../src/util.js';

const secUid = process.argv[2] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380r-H-K8B91qq8KTo';
const port = 9383;
const profile = path.join(os.tmpdir(), 'dy-gallery');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: false, width: 1100, height: 800 });
const ep = await waitEndpoint(port, 20000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();

const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\/aweme\/post/]);
await cdp.navigate(`https://www.douyin.com/user/${secUid}`, { waitMs: 4000 });
await sleep(5000);
for (let i = 0; i < 3; i++) {
  await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
  await sleep(1200);
}
collector.stop();

let gallery = null;
let total = 0;
for (const it of collector.items) {
  const list = it.json?.aweme_list || [];
  total += list.length;
  for (const a of list) {
    if (Array.isArray(a.images) && a.images.length) { gallery = a; break; }
  }
  if (gallery) break;
}

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

console.log(`抓到作品 ${total} 条`);
check('找到图集作品', !!gallery, gallery ? `aweme_id=${gallery.aweme_id} 图片 ${gallery.images.length} 张` : '该用户近期无图文作品');

if (gallery) {
  const cfg = loadConfig(process.cwd());
  const douyin = new DouyinService({ page: async () => ({ cdp }) }, cfg);
  const r = await douyin.download({ id: 1 }, { awemeIds: [String(gallery.aweme_id)] });
  const files = r.results[0]?.files || [];
  const jpgs = files.filter((f) => /\.jpg$/.test(f.file));
  check('下载出图片', jpgs.length > 0, `${files.length} 个文件：${files.map((f) => `${path.basename(f.file)}(${(f.size / 1024).toFixed(0)}KB)`).join(', ')}`);
  check('图片数量与作品一致', jpgs.length === gallery.images.length, `${jpgs.length}/${gallery.images.length}`);
  const dir = r.dir;
  console.log('目录:', dir);
  await sleep(300);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
await sleep(300);
try { process.kill(chrome.pid); } catch { /* ignore */ }
await sleep(600);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
