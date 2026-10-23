/** 关注列表接口探测（容错版） */
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const SEC = process.argv[2] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380rH-K8B91qq8KTo';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 5000 });

const call = async (label, url) => {
  const r = await cdp.evaluate(`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      const text = await res.text();
      let j = null;
      try { j = JSON.parse(text); } catch { return { status: res.status, raw: text.slice(0, 80) }; }
      const arr = j.followings || j.followers || j.user_list || j.data || [];
      return {
        status: res.status, n: arr.length, has_more: j.has_more, min_time: j.min_time,
        status_code: j.status_code,
        first: arr[0] ? { nick: arr[0].nickname, sec: (arr[0].sec_uid || '').slice(0, 16) } : null,
      };
    } catch (e) { return { err: e.message }; }
  })()`);
  console.log(label, JSON.stringify(r));
  return r;
};

const uid = await cdp.evaluate(`(async () => {
  try {
    const res = await fetch('https://www.douyin.com/aweme/v1/web/user/profile/other/?sec_user_id=${SEC}&aid=6383&device_platform=webapp', { credentials: 'include' });
    const j = await res.json();
    return String(j.user?.uid || j.user?.uid_str || '');
  } catch (e) { return 'ERR:' + e.message; }
})()`);
console.log('uid:', uid);

await call('A following?sec_user_id', `https://www.douyin.com/aweme/v1/web/user/following/list/?sec_user_id=${SEC}&count=20&offset=0&aid=6383`);
await new Promise((r) => setTimeout(r, 600));
await call('B following?user_id', `https://www.douyin.com/aweme/v1/web/user/following/list/?user_id=${uid}&sec_user_id=${SEC}&count=20&offset=0&aid=6383&source=following`);
await new Promise((r) => setTimeout(r, 600));
await call('C follow/list', `https://www.douyin.com/aweme/v1/web/user/follow/list/?user_id=${uid}&sec_user_id=${SEC}&count=20&offset=0&aid=6383`);
await new Promise((r) => setTimeout(r, 600));
await call('D following 带 device 参数', `https://www.douyin.com/aweme/v1/web/user/following/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=${SEC}&count=20&offset=0&source=following&version_code=170400`);

cdp.close();
process.exit(0);
