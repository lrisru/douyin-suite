/** 打印 webcast/user 接口的完整字段 */
import { Cdp, listTargets } from '../src/cdp.js';

const uid = process.argv[2] || '1543342457107640';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
if (!t) { console.log('浏览器没开'); process.exit(1); }
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate('https://live.douyin.com/', { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 2000));

const res = await cdp.evaluate(`(async () => {
  const r = await fetch('https://live.douyin.com/webcast/user/?aid=6383&target_uid=${uid}', { credentials: 'include' });
  return await r.json();
})()`);
const d = res.data || {};
console.log('顶层 keys:', Object.keys(res).join(','));
console.log('data keys:', Object.keys(d).join(','));
const pick = {};
for (const k of ['id', 'short_id', 'nickname', 'gender', 'signature', 'city', 'province', 'country', 'district', 'follower_count', 'following_count', 'total_favorited', 'unique_id', 'sec_uid', 'web_rid', 'display_id', 'location_city', 'verify_info', 'follow_info', 'stats']) {
  if (d[k] !== undefined) pick[k] = typeof d[k] === 'object' ? JSON.stringify(d[k]).slice(0, 120) : d[k];
}
console.log('\n关键字段:', JSON.stringify(pick, null, 1));
cdp.close();
process.exit(0);
