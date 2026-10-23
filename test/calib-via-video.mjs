/** 绕开搜索：从视频详情拿作者 sec_uid，再进主页点粉丝 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, ResponseCollector, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const AWEME = process.argv[3] || '7532780281573510446';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\/aweme\/detail/]);
await cdp.navigate(`https://www.douyin.com/video/${AWEME}`, { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 4000));
collector.stop();

let detail = null;
for (const it of collector.items) {
  detail = it.json?.aweme_detail || (it.json?.aweme_list || [])[0] || null;
  if (detail) break;
}
const author = detail?.author;
console.log('详情:', detail ? `desc=${(detail.desc || '').slice(0, 20)}` : '(未取到)');
console.log('作者:', JSON.stringify({ nick: author?.nickname, sec: author?.sec_uid, uid: author?.uid }));

if (!author?.sec_uid) { console.log('没有作者 sec_uid'); cdp.close(); process.exit(1); }

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/aweme\/v1\/web\/user\//.test(u)) reqs.push(u.split('?')[0]);
});

await cdp.navigate(`https://www.douyin.com/user/${author.sec_uid}`, { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 2500));

const s1 = await cdp.evaluate(`(() => ({
  title: document.title,
  notExist: /用户不存在/.test(document.body.innerText || ''),
  tabs: [...document.querySelectorAll('div[role="tab"], span, a, div')]
    .map(e => (e.innerText || '').trim())
    .filter(t => /^(作品|粉丝|关注)\\s*\\d*$/.test(t)).slice(0, 6),
  bodyLen: (document.body.innerText || '').length,
}))()`);
console.log('[主页]', JSON.stringify(s1));
console.log('请求:', JSON.stringify([...new Set(reqs)]));

const tabSel = await cdp.evaluate(`(() => {
  const cands = [...document.querySelectorAll('div[role="tab"], span, a, div')];
  const hit = cands.find(e => /^粉丝\\s*\\d*$/.test((e.innerText || '').trim()));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { text: (hit.innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2, tag: hit.tagName };
})()`);
console.log('[粉丝 tab]', JSON.stringify(tabSel));

if (tabSel) {
  reqs.length = 0;
  await cdp.clickPoint(tabSel.x, tabSel.y);
  await new Promise((r) => setTimeout(r, 5000));
  for (let i = 0; i < 2; i++) {
    await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('[粉丝请求]', JSON.stringify([...new Set(reqs)]));
  const s2 = await cdp.evaluate(`(() => ({
    fans: !!document.querySelector('[data-e2e="user-fans-container"]'),
    links: document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]').length,
    sample: [...document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]')].slice(0,3).map(a=>(a.innerText||'').trim().slice(0,18)),
  }))()`);
  console.log('[粉丝页]', JSON.stringify(s2));
}

await cdp.screenshot(path.resolve('test/followers-page.png'));
fs.writeFileSync(path.resolve('test/calib-video-followers.json'), JSON.stringify({ AWEME, author, s1, tabSel, reqs }, null, 2));
console.log('截图 test/followers-page.png');
cdp.close();
process.exit(0);
