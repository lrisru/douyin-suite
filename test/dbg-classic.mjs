/** 抓经典界面的控制台错误 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';

const port = 9395;
const profile = path.join(os.tmpdir(), 'dy-dbg');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });

launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1400, height: 900 });
const ep = await waitEndpoint(port, 20000);
const cdp = await Cdp.connect((await newTab(port, 'http://127.0.0.1:9527/classic.html')).webSocketDebuggerUrl);
await cdp.enable();

const logs = [];
cdp.on('Runtime.consoleAPICalled', (p) => {
  logs.push(p.type + ': ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
});
cdp.on('Runtime.exceptionThrown', (p) => {
  logs.push('EXCEPTION: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || ''));
});
await cdp.send('Runtime.enable');

await new Promise((r) => setTimeout(r, 12000));

const state = await cdp.evaluate(`(() => ({
  rows: document.querySelectorAll('#tbl tbody tr').length,
  total: document.querySelector('#st-total')?.textContent,
  status: document.querySelector('#st-msg')?.textContent,
  hasCL: typeof CL !== 'undefined',
  hasEsc: typeof esc !== 'undefined',
  firstRowText: document.querySelector('#tbl tbody tr')?.innerText?.slice(0, 60),
}))()`);
console.log('页面状态:', JSON.stringify(state, null, 1));
console.log('\n控制台:', logs.slice(-15).join('\n') || '(无)');

await cdp.screenshot(path.resolve('test/classic-dbg.png'));
cdp.close();
await new Promise((r) => setTimeout(r, 300));
try { process.kill(chrome.pid); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 400));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
