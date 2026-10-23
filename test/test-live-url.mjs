/** 验证 aweme_id 能否直接作为直播间 URL */
import { Cdp, listTargets } from '../src/cdp.js';

const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

for (const id of ['7699428079046757147', '7699653810846911267']) {
  await cdp.navigate(`https://live.douyin.com/${id}`, { waitMs: 6000 });
  const s = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 60),
    title: document.title.slice(0, 40),
    notFound: /页面不存在|找不到|404|直播已结束/.test(document.body.innerText || ''),
    text: (document.body.innerText || '').slice(0, 80).replace(/\\s+/g, ' '),
  }))()`);
  console.log(id, '->', JSON.stringify(s));
}
cdp.close();
process.exit(0);
