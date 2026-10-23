/** 诊断：当前浏览器是否所有页面都跳验证码，并截图 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const urls = [
  'https://www.douyin.com/',
  'https://www.douyin.com/jingxuan',
  'https://www.douyin.com/user/MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380r-H-K8B91qq8KTo',
];

for (const u of urls) {
  await cdp.navigate(u, { waitMs: 5000 });
  const s = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 90),
    title: document.title,
    hasVerify: !!document.querySelector('#captcha_container, .captcha_verify_container, iframe[src*="verify"]'),
    textHead: ((document.body.innerText || '').slice(0, 100)).replace(/\\s+/g, ' '),
  }))()`);
  console.log(JSON.stringify(s));
}

await cdp.navigate('https://www.douyin.com/', { waitMs: 4000 });
const shot = path.resolve('test/captcha-state.png');
await cdp.screenshot(shot);
console.log('截图:', shot);

// 有哪些 cookie 与风控相关
const cookies = await cdp.getCookies(['https://www.douyin.com']);
const risk = cookies.filter((c) => /verify|risk|captcha|passport|sid_/i.test(c.name)).map((c) => `${c.name}=${String(c.value).slice(0, 12)}…`);
console.log('风控相关 cookie:', JSON.stringify(risk));

cdp.close();
process.exit(0);
