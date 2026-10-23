/** 诊断：用户搜索 / 直播搜索 的真实接口与响应结构 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, ResponseCollector, listTargets } from '../src/cdp.js';

const PORT = 9301;
const KW = process.argv[2] || '贴膜';
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

for (const type of ['user', 'live']) {
  const collector = new ResponseCollector(cdp, [/aweme\/v1\/web\//]);
  await cdp.navigate(`https://www.douyin.com/search/${encodeURIComponent(KW)}?type=${type}`, { waitMs: 6000 });
  await new Promise((r) => setTimeout(r, 5000));
  for (let i = 0; i < 2; i++) {
    await cdp.evaluate('window.scrollBy(0, window.innerHeight)');
    await new Promise((r) => setTimeout(r, 1500));
  }
  collector.stop();

  console.log(`\n=== type=${type} 命中 ${collector.items.length} 个响应`);
  for (const it of collector.items) {
    const j = it.json || {};
    const keys = Object.keys(j);
    const arrKey = keys.find((k) => Array.isArray(j[k]) && j[k].length);
    console.log('  URL:', it.url.split('?')[0].replace('https://www.douyin.com', ''));
    console.log('    keys:', keys.slice(0, 10).join(','));
    if (arrKey) {
      console.log(`    ${arrKey}[0] keys:`, Object.keys(j[arrKey][0]).slice(0, 10).join(','));
      console.log(`    ${arrKey}[0] 片段:`, JSON.stringify(j[arrKey][0]).slice(0, 300));
    } else {
      console.log('    无数组字段，data=', JSON.stringify(j.data ?? null).slice(0, 120), 'status=', j.status_code);
    }
  }

  const dom = await cdp.evaluate(`(() => ({
    url: location.href.slice(0, 80),
    cards: document.querySelectorAll('[data-e2e*="search"], li[data-e2e], div[data-e2e]').length,
    text: (document.body.innerText || '').slice(0, 120).replace(/\\s+/g, ' '),
  }))()`);
  console.log('  DOM:', JSON.stringify(dom));
}

cdp.close();
fs.writeFileSync(path.resolve('test/search-types.json'), JSON.stringify({ KW }, null, 2));
process.exit(0);
