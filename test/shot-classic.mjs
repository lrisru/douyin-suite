/** 截图经典界面，确认布局对不对 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9393;
const profile = path.join(os.tmpdir(), 'dy-classic-shot');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1600, height: 900 });
const ep = await waitEndpoint(port, 20000);
if (!ep) { console.error('chrome not ready'); process.exit(1); }
const cdp = await Cdp.connect((await newTab(port, 'http://127.0.0.1:9527/classic.html')).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 6000));

const info = await cdp.evaluate(`(() => ({
  title: document.title,
  menu: [...document.querySelectorAll('.menubar button')].map(b => b.textContent.trim()),
  hasUrl: !!document.querySelector('#url'),
  hasLinks: !!document.querySelector('#links'),
  filters: [...document.querySelectorAll('.filter label')].map(l => l.textContent.trim().slice(0, 12)),
  cols: [...document.querySelectorAll('#tbl thead th')].map(t => t.textContent.trim()),
  rows: document.querySelectorAll('#tbl tbody tr').length,
  status: document.querySelector('#st-msg')?.textContent,
  total: document.querySelector('#st-total')?.textContent,
  screenImg: document.querySelector('#screen')?.src?.slice(0, 40),
}))()`);
console.log(JSON.stringify(info, null, 1));

const out = path.resolve('test/classic-ui.png');
await cdp.screenshot(out);
console.log('\n截图:', out);

cdp.close();
await new Promise((r) => setTimeout(r, 400));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 500));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
