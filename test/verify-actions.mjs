/**
 * 真实互动验证（可还原）：点赞一个作品 → 检查状态 → 取消点赞还原。
 * 只做点赞，不做评论/私信（无法还原）。
 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, listTargets } from '../src/cdp.js';
import { DouyinService, SEL } from '../src/douyin.js';
import { loadConfig } from '../src/util.js';

const PORT = 9301;
const AWEME = process.argv[2] || '';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const cfg = loadConfig(process.cwd());
const host = {
  page: async (acc, url) => { if (url) await cdp.navigate(url, { waitMs: 2500 }); return { cdp }; },
  checkLogin: async () => ({ loggedIn: true }),
};
const douyin = new DouyinService(host, cfg);
const acc = { id: 9 };

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

const readState = async () => cdp.evaluate(`(() => {
  const d = document.querySelector('div[data-e2e="video-player-digg"]');
  return d ? (d.getAttribute('data-e2e-state') || 'none') : null;
})()`);

console.log('作品:', AWEME || '(从数据库取)');
let awemeId = AWEME;
if (!awemeId) {
  const r = await fetch('http://127.0.0.1:9527/api/data/items?limit=1');
  const j = await r.json();
  awemeId = j.data?.[0]?.aweme_id;
}
console.log('使用作品:', awemeId);

const r1 = await douyin.like(acc, { awemeId, url: `https://www.douyin.com/video/${awemeId}` });
console.log('点赞结果:', JSON.stringify(r1));
check('点赞链路可用', r1.ok === true, `changed=${r1.changed} state=${r1.state}`);

const after = await readState();
console.log('点赞后状态:', after);

// 还原：再点一次取消
await cdp.clickSelector(SEL.digg[0]);
await new Promise((r) => setTimeout(r, 1500));
const restored = await readState();
console.log('还原后状态:', restored);
check('已还原为未点赞', /no-digged|not-digged/.test(String(restored)), String(restored));

fs.writeFileSync(path.resolve('test/actions-real.json'), JSON.stringify({ awemeId, r1, after, restored }, null, 2));
console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
process.exit(fail ? 1 : 0);
