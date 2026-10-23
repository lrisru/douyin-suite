/** 私信会话页：等久一点，dump 全部 im 请求并截图 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const reqs = [];
cdp.on('Network.requestWillBeSent', (p) => {
  const u = p.request?.url || '';
  if (/imapi|conversation|\/im\//.test(u)) reqs.push(u.split('?')[0] + '?' + (u.split('?')[1] || '').slice(0, 60));
});

await cdp.navigate('https://www.douyin.com/user/self?showTab=message', { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 9000));

const s = await cdp.evaluate(`(() => {
  const txt = document.body.innerText || '';
  return {
    url: location.href.slice(0, 90),
    title: document.title,
    hasPcim: !!document.querySelector('[class*="conversation"], [class*="session"], [class*="chat"]'),
    classes: [...new Set([...document.querySelectorAll('div[class]')].map(d => d.className.toString()).filter(c => /conversation|session|chat|message/i.test(c)))].slice(0, 8),
    textHead: txt.slice(0, 200).replace(/\\s+/g, ' '),
  };
})()`);
console.log('页面:', JSON.stringify(s, null, 1));
console.log('\nim 请求:');
for (const u of [...new Set(reqs)]) console.log('  ', u);

await cdp.screenshot(path.resolve('test/conversations.png'));

// 试直接调会话接口
const api = async (label, url) => {
  const r = await cdp.evaluate(`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      const text = await res.text();
      let j = null; try { j = JSON.parse(text); } catch { return { status: res.status, raw: text.slice(0, 80) }; }
      return { status: res.status, keys: Object.keys(j).slice(0, 10),
               n: (j.conversation_list || j.conversations || j.data || []).length,
               status_code: j.status_code };
    } catch (e) { return { err: e.message }; }
  })()`);
  console.log(`[${label}]`, JSON.stringify(r));
};
await api('v2 conversation/get_info_list', 'https://imapi.douyin.com/v2/conversation/get_info_list?aid=6383&device_platform=web');
await new Promise((r) => setTimeout(r, 500));
await api('v1 conversation/get_info_list', 'https://imapi.douyin.com/v1/conversation/get_info_list?aid=6383&device_platform=web');
await new Promise((r) => setTimeout(r, 500));
await api('web im conversation', 'https://www.douyin.com/aweme/v1/web/im/conversation/get_info_list/?aid=6383&device_platform=webapp');

console.log('截图 test/conversations.png');
cdp.close();
process.exit(0);
