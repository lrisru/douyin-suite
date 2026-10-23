/** dump 搜索接口真实返回结构 */
import path from 'node:path';
import fs from 'node:fs';
import { Cdp, ResponseCollector, listTargets } from '../src/cdp.js';

const PORT = Number(process.argv[2] || 9301);
const KW = process.argv[3] || '美食';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\/(general\/search|search\/item)/]);
await cdp.navigate(`https://www.douyin.com/search/${encodeURIComponent(KW)}?type=video`, { waitMs: 5000 });
await new Promise((r) => setTimeout(r, 5000));
collector.stop();

console.log('命中', collector.items.length);
for (const it of collector.items.slice(0, 3)) {
  const j = it.json;
  console.log('\nURL:', it.url.slice(0, 100));
  console.log('顶层 keys:', Object.keys(j).join(','));
  const summary = {};
  for (const [k, v] of Object.entries(j)) {
    if (Array.isArray(v)) summary[k] = `array(${v.length})`;
    else if (v && typeof v === 'object') summary[k] = `object{${Object.keys(v).slice(0, 6).join(',')}}`;
    else summary[k] = String(v).slice(0, 40);
  }
  console.log('结构:', JSON.stringify(summary, null, 1));

  // 找数组元素的结构
  for (const [k, v] of Object.entries(j)) {
    if (Array.isArray(v) && v.length) {
      console.log(`\n${k}[0] 的 keys:`, Object.keys(v[0]).join(','));
      console.log(`${k}[0] 片段:`, JSON.stringify(v[0]).slice(0, 600));
      break;
    }
  }
}

fs.writeFileSync(path.resolve('test/search-dump.json'), JSON.stringify(collector.items.map((x) => ({ url: x.url, keys: Object.keys(x.json || {}), sample: JSON.stringify(x.json).slice(0, 3000) })), null, 2));
console.log('\n已写 test/search-dump.json');
cdp.close();
process.exit(0);
