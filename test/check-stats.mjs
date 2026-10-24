/** 验证：作品表格的四项计数是否真的显示出来 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9401;
const profile = path.join(os.tmpdir(), 'dy-stats');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

let pass = 0;
let fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS', n, e); } else { fail++; console.log('FAIL', n, e); } };

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1500, height: 950 });
const ep = await waitEndpoint(port, 20000);
const cdp = await Cdp.connect((await newTab(port, 'http://127.0.0.1:9527/classic.html')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 6000));

await cdp.evaluate(`document.querySelector('[data-mod="search-video"]').click()`);
await new Promise((r) => setTimeout(r, 3500));

const s = await cdp.evaluate(`(() => {
  const rows = [...document.querySelectorAll('#tbl tbody tr')].slice(0, 8);
  return rows.map((tr) => {
    const tds = [...tr.querySelectorAll('td')].map((t) => t.textContent.trim());
    return { title: (tds[2] || '').slice(0, 16), digg: tds[5], comment: tds[6], collect: tds[7], share: tds[8] };
  });
})()`);
console.log('前 8 行:');
for (const r of s) console.log(`  ${(r.title || '').padEnd(18)} 赞${String(r.digg).padStart(6)} 评${String(r.comment).padStart(6)} 藏${String(r.collect).padStart(6)} 转${String(r.share).padStart(6)}`);

const nonZero = s.filter((r) => Number(String(r.collect).replace(/[万亿]/, '')) > 0).length;
check('收藏列有非零值', nonZero > 0, `${nonZero}/8 行非零`);
const cmtNonZero = s.filter((r) => Number(String(r.comment).replace(/[万亿]/, '')) > 0).length;
check('评论列有非零值', cmtNonZero > 0, `${cmtNonZero}/8 行非零`);

await cdp.screenshot(path.resolve('test/stats-fixed.png'));
console.log('\n截图: test/stats-fixed.png');
console.log(`\n${pass} pass, ${fail} fail`);

cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(fail ? 1 : 0);
