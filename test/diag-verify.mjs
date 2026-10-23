/** 查看搜索页当前是否弹出验证，并截图 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate('https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F?type=video', { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 3000));

const info = await cdp.evaluate(`(() => {
  const frames = [...document.querySelectorAll('iframe')].map(f => f.src).filter(Boolean).slice(0, 5);
  const verifyEls = [...document.querySelectorAll('[class*="verify"], [id*="captcha"], .captcha_verify_container, #captcha_container')].map(e => ({
    tag: e.tagName, id: e.id, cls: (e.className || '').toString().slice(0, 60), visible: !!(e.offsetWidth || e.offsetHeight),
  })).slice(0, 6);
  return {
    url: location.href.slice(0, 80),
    title: document.title,
    text: ((document.body.innerText || '').slice(0, 200)).replace(/\\s+/g, ' '),
    iframes: frames,
    verifyEls,
  };
})()`);
console.log(JSON.stringify(info, null, 1));

await cdp.screenshot(path.resolve('test/verify-state.png'));
console.log('截图: test/verify-state.png');
cdp.close();
process.exit(0);
