/** 截图登录二维码 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 1500));

const s = await cdp.evaluate(`(() => ({
  url: location.href.slice(0, 60),
  hasCanvas: !!document.querySelector('canvas'),
  hasQrImg: !!document.querySelector('img[src*="qrcode"], img[src*="qr"]'),
  text: (document.body.innerText || '').slice(0, 100).replace(/\\s+/g, ' '),
}))()`);
console.log('登录页:', JSON.stringify(s, null, 1));

const out = path.resolve('test/login-qr.png');
await cdp.screenshot(out);
console.log('截图:', out);
cdp.close();
process.exit(0);
