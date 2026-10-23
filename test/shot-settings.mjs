/** 截图：设置页的授权卡片 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9391;
const profile = path.join(os.tmpdir(), 'dy-shot-settings');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1440, height: 1000 });
const ep = await waitEndpoint(port, 20000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'http://127.0.0.1:9527/')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 3000));

await cdp.evaluate(`document.querySelector('button[data-tab="settings"]').click()`);
await new Promise((r) => setTimeout(r, 1200));

// 把授权卡片滚到可见位置
await cdp.evaluate(`(() => {
  const h = [...document.querySelectorAll('#panel-settings h3')].find(x => x.textContent.trim() === '授权');
  if (h) h.scrollIntoView({ block: 'center' });
})()`);
await new Promise((r) => setTimeout(r, 600));

const out = path.resolve('test/settings-license.png');
await cdp.screenshot(out);
console.log('截图:', out, fs.statSync(out).size, 'bytes');

const info = await cdp.evaluate(`(() => {
  const h = [...document.querySelectorAll('#panel-settings h3')].find(x => x.textContent.trim() === '授权');
  const card = h ? h.closest('.card') : null;
  return {
    title: card ? card.querySelector('h3').textContent.trim() : '(没找到)',
    kv: card ? card.querySelector('.kv')?.innerText.replace(/\\n/g, ' | ') : '',
    hasInput: !!document.querySelector('#lic-key'),
    btn: [...(card?.querySelectorAll('button') || [])].map(b => b.textContent.trim()),
  };
})()`);
console.log(JSON.stringify(info, null, 1));

cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
