/** 只看搜索相关请求 */
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const KW = process.argv[2] || '贴膜';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/search|discover/i.test(u) && !/\.js|\.css|\.png|\.webp/.test(u)) reqs.push(u);
});

for (const type of ['user', 'live']) {
  reqs.length = 0;
  await cdp.navigate(`https://www.douyin.com/search/${encodeURIComponent(KW)}?type=${type}`, { waitMs: 7000 });
  await new Promise((r) => setTimeout(r, 4000));
  for (let i = 0; i < 2; i++) {
    await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`\n=== type=${type}`);
  for (const u of [...new Set(reqs)]) console.log('  ', u.slice(0, 200));

  const dom = await cdp.evaluate(`(() => {
    const txt = (document.body.innerText || '');
    return {
      url: location.href.slice(0, 70),
      hasUserCards: document.querySelectorAll('[data-e2e="user-info"], a[href*="/user/MS4w"]').length,
      snippet: txt.replace(/\\s+/g, ' ').slice(150, 420),
    };
  })()`);
  console.log('  DOM:', JSON.stringify(dom));
}

cdp.close();
process.exit(0);
