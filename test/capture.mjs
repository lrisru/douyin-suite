/**
 * 采集管道验证脚本：不经过登录校验，直接看 CDP 能不能抓到抖音接口响应。
 * 用法：node test/capture.mjs [关键词] [端口]
 */
import { Cdp, listTargets } from '../src/cdp.js';

const keyword = process.argv[2] || '美食';
const port = Number(process.argv[3] || 9301);

const targets = await listTargets(port);
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('没有可用标签页，先启动账号浏览器');
  process.exit(1);
}

const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
await cdp.enable();

const hits = [];
const off1 = cdp.on('Network.responseReceived', async (p) => {
  const url = p?.response?.url || '';
  if (!/(aweme\/v1\/web|webcast)/.test(url)) return;
  try {
    const body = await cdp.send('Network.getResponseBody', { requestId: p.requestId }, 8000);
    const text = body?.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body?.body;
    const json = JSON.parse(text);
    const n = json?.data?.length ?? json?.aweme_list?.length ?? 0;
    hits.push({ url: url.slice(0, 120), status: p.response.status, len: text.length, items: n });
  } catch { /* not json */ }
});

await cdp.navigate(`https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`, { waitMs: 3000 });
for (let i = 0; i < 4; i++) {
  await cdp.evaluate('window.scrollBy(0, window.innerHeight*0.9)');
  await new Promise((r) => setTimeout(r, 1500));
}
await new Promise((r) => setTimeout(r, 1500));

off1();
cdp.close();

console.log('抓到接口响应：', hits.length);
for (const h of hits.slice(0, 12)) {
  console.log(`  [${h.status}] ${h.items} 条  ${h.url}`);
}
if (!hits.length) {
  const title = await Promise.resolve('');
  console.log('没有抓到 aweme/webcast 接口，可能是未登录被拦或页面结构变了。');
}
