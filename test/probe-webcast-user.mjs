/** 测试 webcast/user 接口：能否用 uid 批量查用户资料（地区/性别/粉丝） */
import { Cdp, listTargets } from '../src/cdp.js';

const UID = process.argv[2] || '123456789';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

// 先在页面上下文里试（带 cookie，最接近真实调用）
await cdp.navigate('https://live.douyin.com/', { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 2500));

const urls = [
  `https://live.douyin.com/webcast/user/?aid=6383&target_uid=${UID}`,
  `https://live.douyin.com/webcast/user/?aid=6383&sec_target_uid=${UID}`,
];

for (const u of urls) {
  const r = await cdp.evaluate(`(async () => {
    try {
      const res = await fetch(${JSON.stringify(u)}, { credentials: 'include' });
      const txt = await res.text();
      return { status: res.status, len: txt.length, head: txt.slice(0, 300) };
    } catch (e) { return { error: String(e) }; }
  })()`);
  console.log('\nURL:', u.replace(/\?.*/, ''));
  console.log(JSON.stringify(r, null, 1).slice(0, 600));
}

cdp.close();
process.exit(0);
