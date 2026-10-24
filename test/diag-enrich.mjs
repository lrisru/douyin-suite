/** 诊断：接口返回的 id 与 comments.user_uid 是否一致 */
import { Cdp, listTargets } from '../src/cdp.js';
import { loadConfig } from '../src/util.js';
import * as db from '../src/db.js';

db.initDb(loadConfig(process.cwd()));
const row = db.getDb().prepare("SELECT user_uid, user_name FROM comments WHERE user_uid <> '' LIMIT 1").get();
console.log('库里:', JSON.stringify(row));

const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const res = await cdp.evaluate(`(async () => {
  const r = await fetch('https://live.douyin.com/webcast/user/?aid=6383&target_uid=${row.user_uid}', { credentials: 'include' });
  const j = await r.json();
  return { code: j.status_code, id: j.data?.id, nickname: j.data?.nickname, city: j.data?.city, gender: j.data?.gender, sig: j.data?.signature };
})()`);
console.log('接口:', JSON.stringify(res));
console.log('id 是否相等:', String(res.id) === String(row.user_uid));
cdp.close();
process.exit(0);
