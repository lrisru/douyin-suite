/** 访问 /user/self 看真实登录用户 */
import { Cdp, listTargets } from '../src/cdp.js';

const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const collector = [];
const orig = cdp.on.bind(cdp);
cdp.on('Network.responseReceived', () => {});

await cdp.navigate('https://www.douyin.com/user/self', { waitMs: 8000 });
await new Promise((r) => setTimeout(r, 3500));

const s = await cdp.evaluate(`(() => {
  const txt = document.body.innerText || '';
  const m = txt.match(/(抖音号[:：]\\s*\\S+)/);
  return {
    url: location.href.slice(0, 70),
    loggedIn: !/登录后免费畅享|扫码登录/.test(txt),
    title: document.title.slice(0, 40),
    douyinId: m ? m[1] : '',
    head: txt.slice(0, 150).replace(/\\s+/g, ' '),
  };
})()`);
console.log(JSON.stringify(s, null, 1));
cdp.close();
process.exit(0);
