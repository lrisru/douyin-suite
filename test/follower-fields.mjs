/** dump followers / following 接口的完整字段结构 */
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const SEC = process.argv[3] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380rH-K8B91qq8KTo';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 5000 });

const probe = async (label, path) => {
  const r = await cdp.evaluate(`(async () => {
    const url = ${JSON.stringify(path)};
    const res = await fetch(url, { credentials: 'include', headers: { referer: location.href } });
    const j = await res.json();
    const arr = j.followers || j.user_list || j.data || [];
    const first = arr[0] || null;
    return {
      status: res.status,
      total: arr.length,
      hasMore: j.has_more,
      maxTime: j.max_time,
      minTime: j.min_time,
      keys: first ? Object.keys(first).slice(0, 30) : [],
      first: first ? {
        nickname: first.nickname, uid: first.uid, sec_uid: first.sec_uid,
        unique_id: first.unique_id, follower_count: first.follower_count,
        signature: first.signature, avatar: (first.avatar_thumb?.url_list||[])[0]?.slice(0,60),
        gender: first.gender, city: first.city, custom_verify: first.custom_verify,
      } : null,
    };
  })()`);
  console.log(`\n[${label}]`, JSON.stringify(r, null, 1));
  return r;
};

const q = (kind) => `https://www.douyin.com/aweme/v1/web/user/${kind}/?sec_user_id=${SEC}&count=20&offset=0&aid=6383`;
await probe('followers', q('follower/list'));
await probe('following', q('following/list'));

cdp.close();
process.exit(0);
