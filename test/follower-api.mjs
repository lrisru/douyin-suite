/** 直接调 follower/following 接口，看是否还能拿到数据（同源 fetch，自动带 cookie） */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const SEC = process.argv[3] || 'MS4wLjABAAAAo4_zpk9xBJmFrcS0KeYeG0U4N-380rH-K8B91qq8KTo';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 6000 });
await new Promise((r) => setTimeout(r, 1500));

const call = async (label, url) => {
  const r = await cdp.evaluate(`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include', headers: { 'referer': location.href } });
      const text = await res.text();
      let j = null;
      try { j = JSON.parse(text); } catch { /* not json */ }
      return {
        status: res.status,
        len: text.length,
        keys: j ? Object.keys(j).slice(0, 12) : null,
        hasMore: j?.has_more ?? null,
        statusCode: j?.status_code ?? null,
        nil: j?.search_nil_info ?? null,
        listLen: (j?.user_list || j?.followers || j?.data || []).length,
        sample: (j?.user_list || j?.followers || [])[0] ? JSON.stringify((j.user_list || j.followers)[0]).slice(0, 240) : '',
        head: j ? '' : text.slice(0, 120),
      };
    } catch (e) { return { err: e.message }; }
  })()`);
  console.log(`[${label}]`, JSON.stringify(r, null, 1));
  return r;
};

const base = 'https://www.douyin.com/aweme/v1/web/user';
const q = `device_platform=webapp&aid=6383&channel=channel_pc_web&pc_client_type=1&version_code=170400&version_name=17.4.0&cookie_enabled=true&platform=PC&downlink=10&sec_user_id=${SEC}&count=20&offset=0&source=following&update_version_code=170400`;

await call('follower/list', `${base}/follower/list/?${q}`);
await call('following/list', `${base}/following/list/?${q}&user_id=`);

// 也试一下旧版接口
await call('follower/list(旧)', `https://www.douyin.com/aweme/v1/web/user/follower/list/?sec_user_id=${SEC}&count=20&offset=0&aid=6383`);

fs.writeFileSync(path.resolve('test/follower-api.json'), JSON.stringify({ SEC }, null, 2));
cdp.close();
process.exit(0);
