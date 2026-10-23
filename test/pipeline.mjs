/**
 * 采集管道端到端：本地 HTTP 站点返回真实结构的 JSON，
 * 验证 capturePage → ResponseCollector → collectFromJson 全链路。
 */
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { DouyinService } from '../src/douyin.js';
import { loadConfig } from '../src/util.js';

const PORT = 9360;
const API = path.join('data');
void API;

const payloads = {
  '/api/followers': {
    user_list: [
      { sec_uid: 'MS4wLjABu1', uid: '2001', nickname: '粉丝甲', unique_id: 'fans1', follower_count: 88, signature: '你好' },
      { sec_uid: 'MS4wLjABu2', uid: '2002', nickname: '粉丝乙', follower_count: 9 },
    ],
    has_more: 1,
  },
  '/api/following': {
    user_list: [{ sec_uid: 'MS4wLjABu3', uid: '2003', nickname: '关注丙', follower_count: 5 }],
  },
  '/api/conversations': {
    conversation_list: [{
      conversation_id: 'conv_1',
      participant: { nickname: '客户A', sec_uid: 'MS4wLjABc', uid: '3001' },
      unread_count: 2,
      last_message: { content: '在吗', created_at: 1792658000 },
    }],
  },
  '/api/comments': {
    comments: [
      { cid: 'c1', aweme_id: '7400', text: '第一次评论', user: { nickname: '路人甲', uid: '4001' }, digg_count: 3, create_time: 1792658000 },
      { cid: 'c2', aweme_id: '7400', text: '第二次评论', user: { nickname: '路人乙', uid: '4002' }, digg_count: 1, create_time: 1792658001 },
    ],
    has_more: 0,
  },
  '/api/search': {
    data: [
      { type: 1, aweme_info: { aweme_id: '7400000001', desc: '搜索命中作品', author: { nickname: '作者A', sec_uid: 'MS4wA' }, statistics: { digg_count: 10 } } },
    ],
  },
};

const page = (kind) => `<!doctype html><meta charset="utf-8"><title>pipeline ${kind}</title>
<body><div id="out">loading</div>
<script>
  const kind = ${JSON.stringify(kind)};
  fetch('/api/' + kind).then(r => r.json()).then(j => {
    document.getElementById('out').textContent = 'ok:' + JSON.stringify(j).length;
  }).catch(e => { document.getElementById('out').textContent = 'err:' + e.message; });
</script></body>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname.startsWith('/page')) {
    const kind = u.searchParams.get('kind') || 'followers';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page(kind));
  }
  const data = payloads[u.pathname];
  if (data) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(data));
  }
  res.writeHead(404);
  res.end('not found');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(os.tmpdir(), 'dy-pipeline-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

const chromePath = findChrome({});
launchChrome({ chromePath, profileDir: profile, port: 9361, headless: true, width: 900, height: 700 });
const ep = await waitEndpoint(9361, 20000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(9361, 'about:blank')).webSocketDebuggerUrl);
await cdp.enable();

const cfg = loadConfig(process.cwd());
const host = {
  page: async () => ({ cdp }),
  checkLogin: async () => ({ loggedIn: true }),
};
const douyin = new DouyinService(host, cfg);
const acc = { id: 1 };

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

const patterns = [/\/api\//];
const base = `http://127.0.0.1:${PORT}`;

// 粉丝/关注/会话已改为「页面内接口分页 + DOM 提取」，见 test/pipeline2.mjs
const rel = await douyin.followers(acc, { secUid: 'x', url: `${base}/page?kind=followers`, patterns, scrolls: 0 });
console.log('SKIP 粉丝管道（改为接口分页，见 pipeline2）', rel.users.length);

const fol = await douyin.following(acc, { secUid: 'x', url: `${base}/page?kind=following`, patterns, scrolls: 0 });
console.log('SKIP 关注管道（同上）', fol.users.length);

const conv = await douyin.conversations(acc, { url: `${base}/page?kind=conversations`, patterns });
console.log('SKIP 会话管道（实现改为 DOM 提取，见 pipeline2）', conv.conversations.length);

const cm = await douyin.comments(acc, { awemeId: '7400', url: `${base}/page?kind=comments`, patterns, scrolls: 0 });
check('评论管道', cm.comments.length === 2 && cm.comments[1].text === '第二次评论');

const se = await douyin.search(acc, { keyword: '测试', url: `${base}/page?kind=search`, patterns, scrolls: 0 });
check('搜索管道', se.items.length === 1 && se.items[0].desc === '搜索命中作品');

// 不匹配的模式应当收不到数据
const none = await douyin.comments(acc, { awemeId: '7400', url: `${base}/page?kind=comments`, patterns: [/never-match-xyz/], scrolls: 0 });
check('模式不匹配时为空', none.comments.length === 0);

console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
await new Promise((r) => setTimeout(r, 500));
try { process.kill(chrome.pid); } catch { /* ignore */ }
server.close();
await new Promise((r) => setTimeout(r, 600));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
