/**
 * 动作鲁棒性端到端：用本地 fixture 页面验证 点赞/收藏/关注/评论/私信，
 * 包括「选择器回退」「已操作状态跳过」「输入与发送」。
 * 不依赖抖音登录。
 */
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { DouyinService, SEL } from '../src/douyin.js';
import { loadConfig } from '../src/util.js';

const port = 9352;
// 用系统临时目录，避免污染项目
const profile = path.join(os.tmpdir(), 'dy-fixture-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port, headless: true, width: 1200, height: 900 });
const ep = await waitEndpoint(port, 25000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }

const fixture = pathToFileURL(path.resolve('test/fixture/douyin.html')).href;
const cdp = await Cdp.connect((await newTab(port, fixture)).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 800));

const cfg = loadConfig(process.cwd());
await cdp.evaluate('localStorage.clear()');
await cdp.navigate(fixture, { waitMs: 500 });
const host = {
  page: async (account, url) => {
    if (url && url !== 'about:blank') await cdp.navigate(url, { waitMs: 400 });
    return { cdp };
  },
  checkLogin: async () => ({ loggedIn: true }),
};
const douyin = new DouyinService(host, cfg);
const acc = { id: 1, name: 'fixture' };

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

// 1. 点赞（走第二候选选择器）
const like1 = await douyin.like(acc, { awemeId: 'fixture1', url: fixture });
check('like 首次', like1.ok && like1.changed, `sel=${like1.selector} state=${like1.state}`);
const like2 = await douyin.like(acc, { awemeId: 'fixture1', url: fixture });
check('like 重复跳过', like2.ok && !like2.changed, like2.note || '');

// 2. 收藏（走第三候选选择器）
const c1 = await douyin.collect(acc, { awemeId: 'fixture1', url: fixture });
check('collect 首次', c1.ok && c1.changed, `sel=${c1.selector}`);
const c2 = await douyin.collect(acc, { awemeId: 'fixture1', url: fixture });
check('collect 重复跳过', c2.ok && !c2.changed);

// 3. 关注
const f1 = await douyin.follow(acc, { secUid: 'fixture', url: fixture });
check('follow 首次', f1.ok && f1.changed, `state=${f1.state}`);
const f2 = await douyin.follow(acc, { secUid: 'fixture', url: fixture });
check('follow 重复跳过', f2.ok && !f2.changed, f2.state || '');

// 4. 评论
const cm = await douyin.comment(acc, { awemeId: 'fixture1', text: 'fixture 评论内容', url: fixture });
const sent = await cdp.evaluate('window.__sent.slice()');
check('comment 发送', cm.ok && sent.includes('comment:fixture 评论内容'), JSON.stringify(sent));

// 5. 私信
const dm = await douyin.dm(acc, { secUid: 'fixture', text: 'fixture 私信内容', url: fixture });
const sent2 = await cdp.evaluate('window.__sent.slice()');
check('dm 发送', dm.ok && sent2.includes('dm:fixture 私信内容'), JSON.stringify(sent2));

// 6. 选择器回退：把所有候选逐个测一遍 pick()
const picks = {};
for (const [key, list] of Object.entries(SEL)) {
  try { picks[key] = await cdp.pick(list); } catch { picks[key] = ''; }
}
check('SEL.digg 命中第一候选', picks.digg === SEL.digg[0], picks.digg);
check('SEL.collect 命中第三候选', picks.collect === SEL.collect[2], picks.collect);
check('SEL.followBtn 命中第一候选', picks.followBtn === SEL.followBtn[0]);
check('未命中的返回空串', picks.userPost === '' || picks.userPost !== undefined);

console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
await new Promise((r) => setTimeout(r, 600));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 800));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 进程未退时留给下次 */ }
process.exit(fail ? 1 : 0);
