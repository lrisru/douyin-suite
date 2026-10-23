/** 搜索 + 粉丝列表联合标定：登录态下搜关键词，抓作者 sec_uid，再进主页点粉丝 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, ResponseCollector, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const KW = process.argv[3] || '美食';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/aweme\/v1\/web\//.test(u)) reqs.push(u.split('?')[0]);
});

// 1. 搜索
const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\/(general\/search|search\/item)/]);
await cdp.navigate(`https://www.douyin.com/search/${encodeURIComponent(KW)}?type=video`, { waitMs: 5000 });
await new Promise((r) => setTimeout(r, 4000));
for (let i = 0; i < 3; i++) {
  await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
  await new Promise((r) => setTimeout(r, 1500));
}
collector.stop();

const awemes = [];
for (const it of collector.items) {
  const list = it.json?.data || it.json?.aweme_list || [];
  for (const x of list) {
    const a = x.aweme_info || x;
    if (a?.aweme_id) awemes.push(a);
  }
}
console.log(`搜索接口命中 ${collector.items.length} 次，作品 ${awemes.length} 条`);
console.log('搜索请求:', JSON.stringify([...new Set(reqs.filter(u => /search/.test(u)))]));
if (awemes[0]) {
  console.log('样例:', JSON.stringify({
    id: awemes[0].aweme_id,
    desc: (awemes[0].desc || '').slice(0, 30),
    author: awemes[0].author?.nickname,
    sec: (awemes[0].author?.sec_uid || '').slice(0, 24),
    digg: awemes[0].statistics?.digg_count,
  }));
}

const sec = awemes.find((a) => a.author?.sec_uid)?.author?.sec_uid;
if (!sec) { console.log('没拿到 sec_uid'); cdp.close(); process.exit(1); }

// 2. 作者主页
reqs.length = 0;
await cdp.navigate(`https://www.douyin.com/user/${sec}`, { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 2500));
const s1 = await cdp.evaluate(`(() => ({
  title: document.title,
  notExist: /用户不存在/.test(document.body.innerText || ''),
  hasUserInfo: !!document.querySelector('div[data-e2e="user-info"]'),
  tabs: [...document.querySelectorAll('div[role="tab"], span, a, div')]
    .map(e => (e.innerText || '').trim())
    .filter(t => /^(作品|粉丝|关注)\\s*\\d*$/.test(t)).slice(0, 6),
  bodyLen: (document.body.innerText || '').length,
}))()`);
console.log('[主页]', JSON.stringify(s1));

// 3. 点粉丝
const tabSel = await cdp.evaluate(`(() => {
  const cands = [...document.querySelectorAll('div[role="tab"], span, a, div')];
  const hit = cands.find(e => /^粉丝\\s*\\d*$/.test((e.innerText || '').trim()));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { text: (hit.innerText||'').trim(), x: r.x + r.width/2, y: r.y + r.height/2, tag: hit.tagName, cls: (hit.className||'').toString().slice(0,40) };
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
  const fanReqs = [...new Set(reqs.filter(u => /user\//.test(u)))];
  console.log('[粉丝请求]', JSON.stringify(fanReqs));
  const s2 = await cdp.evaluate(`(() => ({
    fansContainer: !!document.querySelector('[data-e2e="user-fans-container"]'),
    links: document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]').length,
    sample: [...document.querySelectorAll('[data-e2e="user-fans-container"] a[href*="/user/"]')].slice(0,3).map(a=>(a.innerText||'').trim().slice(0,20)),
  }))()`);
  console.log('[粉丝页]', JSON.stringify(s2));
}

await cdp.screenshot(path.resolve('test/followers-page.png'));
fs.writeFileSync(path.resolve('test/calib-search-followers.json'), JSON.stringify({ KW, awemes: awemes.length, sec, s1, tabSel, reqs }, null, 2));
console.log('报告已存');
cdp.close();
process.exit(0);
