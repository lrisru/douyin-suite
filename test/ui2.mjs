/** 新页面截图：直播 / 定时 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, launchChrome, waitEndpoint, newTab } from '../src/cdp.js';
import { findChrome } from '../src/cdp.js';

const port = 9333;
const outDir = path.resolve('test');
const profile = path.resolve('test/.ui-profile');
fs.mkdirSync(profile, { recursive: true });

const chrome = findChrome({});
if (!chrome) { console.error('no chrome'); process.exit(1); }

launchChrome({ chromePath: chrome, profileDir: profile, port, headless: true, width: 1440, height: 980 });
const ep = await waitEndpoint(port, 20000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }

const t = await newTab(port, 'http://127.0.0.1:9527/');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 2500));
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });

for (const tab of ['live', 'schedules', 'collect']) {
  const ok = await cdp.evaluate(`(() => { const b = document.querySelector('button[data-tab="${tab}"]'); if (!b) return false; b.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  const file = path.join(outDir, `ui-${tab}.png`);
  await cdp.screenshot(file);
  console.log(tab, ok, fs.statSync(file).size);
}

const tabs = await cdp.evaluate('[...document.querySelectorAll("#tabs button")].map(b=>b.textContent)');
console.log('tabs:', JSON.stringify(tabs));
cdp.close();
await new Promise((r) => setTimeout(r, 300));
try { process.kill(-chrome.pid); } catch { /* ignore */ }
process.exit(0);
