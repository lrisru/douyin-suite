/** 真实收藏验证（可还原） */
import { Cdp, listTargets } from '../src/cdp.js';
import { DouyinService, SEL } from '../src/douyin.js';
import { loadConfig } from '../src/util.js';

const PORT = 9301;
const AWEME = process.argv[2] || '7689079605591887144';
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
const read = async () => cdp.evaluate(`(() => {
  const d = document.querySelector('div[data-e2e="video-player-collect"]');
  return d ? (d.getAttribute('data-e2e-state') || '') : null;
})()`);

const before = await read();
console.log('收藏前:', before);

const r = await douyin.collect(acc, { awemeId: AWEME, url: `https://www.douyin.com/video/${AWEME}` });
console.log('收藏结果:', JSON.stringify(r));
check('收藏链路可用', r.ok === true, `state=${r.state}`);

// 还原：再点一次
await cdp.clickSelector(SEL.collect[0]);
await new Promise((res) => setTimeout(res, 1600));
const after = await read();
console.log('还原后:', after);
check('已还原为未收藏', /no-collected/.test(String(after)) || !/collected/.test(String(after).replace('no-collected', '')), String(after));

console.log(`\n${pass} pass, ${fail} fail`);
cdp.close();
process.exit(fail ? 1 : 0);
