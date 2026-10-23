/** 检查当前浏览器登录态 */
import { Cdp, listTargets } from '../src/cdp.js';

const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate('https://www.douyin.com/', { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 2500));

const s = await cdp.evaluate(`(() => {
  const txt = document.body.innerText || '';
  return {
    url: location.href.slice(0, 50),
    needLogin: /登录后免费畅享|扫码登录|验证码登录/.test(txt),
    loginBtn: [...document.querySelectorAll('button, div, span')].some((e) => (e.innerText || '').trim() === '登录'),
    avatars: document.querySelectorAll('img[class*="avatar"]').length,
    topText: txt.slice(0, 80).replace(/\\s+/g, ' '),
  };
})()`);
console.log(JSON.stringify(s, null, 1));

// cookie 里有 sessionid 才说明真登录
const cookies = await cdp.send('Network.getCookies', { urls: ['https://www.douyin.com'] });
const names = (cookies.cookies || []).map((c) => c.name);
console.log('\n关键 cookie:', {
  sessionid: names.includes('sessionid'),
  sessionid_ss: names.includes('sessionid_ss'),
  passport_csrf_token: names.includes('passport_csrf_token'),
  total: names.length,
});

cdp.close();
process.exit(0);
