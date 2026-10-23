/** dump discover/search 与 live/search 的响应结构 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, ResponseCollector, listTargets } from '../src/cdp.js';

const PORT = 9301;
const KW = process.argv[2] || '贴膜';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

for (const [type, pat] of [['user', /discover\/search/], ['live', /live\/search/]]) {
  const collector = new ResponseCollector(cdp, [pat]);
  await cdp.navigate(`https://www.douyin.com/search/${encodeURIComponent(KW)}?type=${type}`, { waitMs: 7000 });
  await new Promise((r) => setTimeout(r, 3000));
  collector.stop();

  console.log(`\n=== ${type} 命中 ${collector.items.length}`);
  for (const it of collector.items.slice(0, 2)) {
    const j = it.json || {};
    console.log('  keys:', Object.keys(j).join(','));
    for (const k of Object.keys(j)) {
      const v = j[k];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
        console.log(`  ${k}[0] keys:`, Object.keys(v[0]).slice(0, 12).join(','));
        console.log(`  ${k}[0]:`, JSON.stringify(v[0]).slice(0, 400));
        break;
      }
    }
    console.log('  status_code=', j.status_code, 'data=', Array.isArray(j.data) ? 'array(' + j.data.length + ')' : typeof j.data);
  }
}

cdp.close();
process.exit(0);
