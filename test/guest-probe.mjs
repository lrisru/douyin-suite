/**
 * 游客态边界探测：不登录的情况下，搜索/用户页/评论区到底能不能拿到数据。
 * 用有头浏览器 + 指纹 + 较长等待，尽量排除"等待不够"的误判。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, ResponseCollector, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { applyFingerprint, fingerprintProfile } from '../src/fingerprint.js';

const port = 9372;
const profile = path.join(os.tmpdir(), 'dy-guest-probe');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: false, width: 1280, height: 900 });
const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();
await applyFingerprint(cdp, fingerprintProfile('guest-probe'));

const report = [];

async function probe(label, url, waitMs = 9000) {
  const hits = [];
  const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\//, /webcast\//, /imapi\.douyin/]);
  await cdp.navigate(url, { waitMs: 1500 });
  await new Promise((r) => setTimeout(r, waitMs));
  collector.stop();

  for (const it of collector.items) {
    const j = it.json || {};
    const n = j.data?.length ?? j.aweme_list?.length ?? j.user_list?.length ?? j.conversation_list?.length ?? 0;
    hits.push({ url: it.url.slice(0, 90), items: n });
  }
  const dom = await cdp.evaluate(`(() => {
    const t = (document.body && document.body.innerText) || '';
    const hasLogin = /登录|扫码登录/.test(t.slice(0, 4000));
    const hasModal = !!document.querySelector('[data-e2e="login-modal"], #login-panel, .login-mask, div[class*="login"]');
    const cards = document.querySelectorAll('[data-e2e="feed-item"], li[data-e2e="scroll-list-item"], div[data-e2e="user-info"]').length;
    return { title: document.title.slice(0, 40), hasLogin, hasModal, cards, textLen: t.length, head: t.slice(0, 120).replace(/\\s+/g, ' ') };
  })()`);
  report.push({ label, url, requests: hits.length, withData: hits.filter((h) => h.items > 0).length, dom });
  console.log(`\n=== ${label}`);
  console.log(`  URL: ${url}`);
  console.log(`  接口命中 ${hits.length}，其中有数据 ${hits.filter((h) => h.items > 0).length}`);
  for (const h of hits.slice(0, 5)) console.log(`    [${h.items}] ${h.url}`);
  console.log(`  DOM: ${JSON.stringify(dom)}`);
}

await probe('PC 搜索-视频', 'https://www.douyin.com/search/美食?type=video', 9000);
await probe('PC 搜索-用户', 'https://www.douyin.com/search/美食?type=user', 9000);
await probe('PC 精选', 'https://www.douyin.com/jingxuan', 6000);
await probe('移动版 搜索', 'https://m.douyin.com/search/美食', 8000);

const out = path.resolve('test/guest-probe.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log('\n报告:', out);
cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
