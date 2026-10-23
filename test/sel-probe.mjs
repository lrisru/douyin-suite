/**
 * 真实页面选择器体检：打开真实抖音页面，逐个检查 SEL 里每个候选是否命中。
 * 不需要登录（元素存在性可查，点击动作才需要登录态）。
 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { SEL } from '../src/douyin.js';

const port = 9353;
const profile = path.resolve('test/.probe-profile-sel');
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: true, width: 1280, height: 900 });
const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();

const secUid = process.argv[2] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380r-H-K8B91qq8KTo';
const awemeId = process.argv[3] || '7532780281573510446';

const pages = [
  { name: '用户主页', url: `https://www.douyin.com/user/${secUid}`, keys: ['followBtn', 'userPost', 'dmEntry', 'commentIcon'] },
  { name: '视频页', url: `https://www.douyin.com/video/${awemeId}`, keys: ['digg', 'collect', 'commentIcon', 'commentInput', 'commentEditor', 'commentSend'] },
];

const report = {};

for (const p of pages) {
  console.log(`\n=== ${p.name} ${p.url}`);
  await cdp.navigate(p.url, { waitMs: 5000 });
  await new Promise((r) => setTimeout(r, 2500));
  const title = await cdp.evaluate('document.title');
  console.log('title:', title);
  report[p.name] = { url: p.url, title, checks: {} };

  // 视频页先点开评论区，才能检查评论输入框
  if (p.name === '视频页') {
    const opened = await cdp.evaluate(`(() => {
      const el = document.querySelector('div[data-e2e="feed-comment-icon"]');
      if (!el) return false;
      el.click();
      return true;
    })()`);
    console.log(' 点开评论区:', opened);
    await new Promise((r) => setTimeout(r, 2500));
  }

  for (const key of p.keys) {
    const list = SEL[key] || [];
    const rows = [];
    for (const sel of list) {
      let n = 0;
      try {
        n = await cdp.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
      } catch (e) {
        n = -1;
      }
      rows.push({ sel, count: n });
    }
    const hit = rows.find((r) => r.count > 0);
    report[p.name].checks[key] = { hit: hit?.sel || '', rows };
    console.log(` ${key.padEnd(14)} ${hit ? '✓ ' + hit.sel + ' (' + hit.count + ')' : '✗ 全部未命中'}  ${rows.map((r) => r.count).join('/')}`);
  }
}

const out = path.resolve('test/sel-report.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log('\n报告:', out);

cdp.close();
await new Promise((r) => setTimeout(r, 500));
try { process.kill(chrome.pid); } catch { /* ignore */ }
process.exit(0);
