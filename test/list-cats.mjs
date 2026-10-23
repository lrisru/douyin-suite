/** 列出直播分类链接 */
import { Cdp, listTargets } from '../src/cdp.js';

const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate('https://live.douyin.com/', { waitMs: 6000 });

const nav = await cdp.evaluate(`(() => [...document.querySelectorAll('a[href*="categorynew"]')]
  .map(a => ((a.innerText || '').trim() + ' -> ' + a.getAttribute('href'))))()`);
console.log(nav.join('\n'));
cdp.close();
process.exit(0);
