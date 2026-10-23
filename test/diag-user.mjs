/** 诊断指定 sec_uid 的用户页与作品 */
import { Cdp, ResponseCollector, listTargets } from '../src/cdp.js';

const SEC = process.argv[2] || 'MS4wLjABAAAAt1APWHiXs8i_-lHdpUhrvjdhrASuSFljtVearRuNQNrmrFbT';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\/(user\/profile|aweme\/post)/]);
await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 3000));
for (let i = 0; i < 2; i++) {
  await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
  await new Promise((r) => setTimeout(r, 1500));
}
collector.stop();

const dom = await cdp.evaluate(`(() => ({
  url: location.href.slice(0, 70),
  title: document.title,
  notExist: /用户不存在/.test(document.body.innerText || ''),
  bodyLen: (document.body.innerText || '').length,
  text: (document.body.innerText || '').slice(0, 150).replace(/\\s+/g, ' '),
}))()`);
console.log('DOM:', JSON.stringify(dom, null, 1));

for (const it of collector.items) {
  const j = it.json || {};
  console.log('\n接口:', it.url.split('?')[0].replace('https://www.douyin.com', ''));
  if (j.user) console.log('  用户:', j.user.nickname, '| 作品数:', j.user.aweme_count, '| 粉丝:', j.user.follower_count);
  if (Array.isArray(j.aweme_list)) console.log('  作品列表:', j.aweme_list.length, '条');
}

await cdp.screenshot('test/diag-user.png');
console.log('\n截图 test/diag-user.png');
cdp.close();
process.exit(0);
