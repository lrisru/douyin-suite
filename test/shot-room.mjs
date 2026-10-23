/** 截图指定直播间 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const RID = process.argv[2] || '324127181125';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate(`https://live.douyin.com/${RID}`, { waitMs: 8000 });
await new Promise((r) => setTimeout(r, 2000));
await cdp.screenshot(path.resolve(`test/room-${RID}.png`));
const s = await cdp.evaluate(`(() => ({
  title: document.title,
  online: (document.body.innerText.match(/在线观众[^\\n]{0,8}/) || [''])[0],
  cart: /购物袋|商品卡|小黄车/.test(document.body.innerText || ''),
  btnTexts: [...document.querySelectorAll('div,span,button')].map(e => (e.innerText||'').trim()).filter(t => t && t.length <= 4 && /购物|商品|橱窗|小店|店铺/.test(t)),
}))()`);
console.log(JSON.stringify(s, null, 1));
console.log('截图 test/room-' + RID + '.png');
cdp.close();
process.exit(0);
