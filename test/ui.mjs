/** 打开控制台并截图，验证前端渲染 */
import fs from 'node:fs';
import path from 'node:path';
import { Cdp, newTab, listTargets } from '../src/cdp.js';

const port = Number(process.argv[2] || 9301);
const out = process.argv[3] || path.resolve('test/shot.png');

const t = await newTab(port, 'http://127.0.0.1:9527/');
if (!t?.webSocketDebuggerUrl) { console.error('无法创建标签页'); process.exit(1); }
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 2500));
const title = await cdp.evaluate('document.title');
const tabs = await cdp.evaluate('[...document.querySelectorAll("#tabs button")].map(b=>b.textContent)');
const stats = await cdp.evaluate('document.querySelector("#stats")?.innerText || ""');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 400));
await cdp.screenshot(out);
console.log('title:', title);
console.log('tabs:', JSON.stringify(tabs));
console.log('stats:', stats.replace(/\n/g, ' | '));
console.log('shot:', out, fs.statSync(out).size);
cdp.close();
