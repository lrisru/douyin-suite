/** 验证：去掉 blink 参数后，是否还有「不受支持的命令行标记」横幅 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9399;
const profile = path.join(os.tmpdir(), 'dy-flagtest');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: false, width: 1200, height: 800 });
const ep = await waitEndpoint(port, 20000);
if (!ep) { console.error('chrome 启动失败'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'https://www.douyin.com/')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 5000));

const s = await cdp.evaluate(`(() => {
  const t = document.body.innerText || '';
  return {
    url: location.href.slice(0, 50),
    hasWarning: /不受支持的命令行标记|unsupported command-line flag/.test(t),
    webdriver: navigator.webdriver,
    plugins: navigator.plugins.length,
    languages: (navigator.languages || []).join(','),
  };
})()`);
console.log(JSON.stringify(s, null, 1));

await cdp.screenshot(path.resolve('test/flag-check.png'));
console.log('截图: test/flag-check.png');

cdp.close();
await new Promise((r) => setTimeout(r, 500));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
