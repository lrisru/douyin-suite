/** 探测粉丝列表翻页参数：offset / max_time / cursor */
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const SEC = process.argv[2] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380rH-K8B91qq8KTo';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 5000 });

const call = async (qs) => {
  const url = `https://www.douyin.com/aweme/v1/web/user/follower/list/?${qs}`;
  const r = await cdp.evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
    const j = await res.json();
    const arr = j.followers || [];
    return { n: arr.length, has_more: j.has_more, max_time: j.max_time, min_time: j.min_time, cursor: j.cursor ?? null,
             first: arr[0]?.nickname || '', last: arr[arr.length-1]?.nickname || '' };
  })()`);
  console.log(qs, '->', JSON.stringify(r));
  return r;
};

const p1 = await call(`sec_user_id=${SEC}&count=20&offset=0&aid=6383`);
await new Promise((r) => setTimeout(r, 800));
await call(`sec_user_id=${SEC}&count=20&offset=20&aid=6383`);
await new Promise((r) => setTimeout(r, 800));
await call(`sec_user_id=${SEC}&count=20&offset=0&max_time=${p1.max_time}&aid=6383`);
await new Promise((r) => setTimeout(r, 800));
await call(`sec_user_id=${SEC}&count=20&offset=20&max_time=${p1.max_time}&aid=6383`);
await new Promise((r) => setTimeout(r, 800));
await call(`sec_user_id=${SEC}&count=20&offset=20&min_time=${p1.min_time}&aid=6383`);
await new Promise((r) => setTimeout(r, 800));
await call(`sec_user_id=${SEC}&count=20&cursor=${p1.max_time}&aid=6383`);

cdp.close();
process.exit(0);
