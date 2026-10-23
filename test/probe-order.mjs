/** 探测抖音商城/订单页是否可访问 */
import { Cdp, listTargets } from '../src/cdp.js';

const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

for (const u of [
  'https://www.douyin.com/shop',
  'https://haohuo.jinritemai.com/views/order/index',
  'https://www.douyin.com/falcon/webcast_openpc/pages/mall/index.html',
]) {
  try {
    await cdp.navigate(u, { waitMs: 6000 });
    const s = await cdp.evaluate(`(() => ({
      url: location.href.slice(0, 80),
      title: document.title.slice(0, 40),
      text: ((document.body.innerText || '').slice(0, 120)).replace(/\\s+/g, ' '),
      hasOrder: /订单|待发货|待收货|已购买/.test(document.body.innerText || ''),
    }))()`);
    console.log(u, '->', JSON.stringify(s));
  } catch (e) {
    console.log(u, 'ERR', e.message);
  }
}

cdp.close();
process.exit(0);
