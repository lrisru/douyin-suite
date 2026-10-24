import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from "../src/cdp.js";

const port = 9398;
const profile = path.join(os.tmpdir(), "dy-watch-ui");
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1500, height: 950 });
const ep = await waitEndpoint(port, 20000);
const cdp = await Cdp.connect((await newTab(port, "http://127.0.0.1:9527/classic.html")).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 6000));

// 切到自动化操作区
await cdp.evaluate(`document.querySelector('[data-mod="auto"]').click()`);
await new Promise((r) => setTimeout(r, 3000));

const info = await cdp.evaluate(`(() => ({
  panelVisible: document.querySelector('#watch-panel').style.display !== 'none',
  tableHidden: document.querySelector('.table-wrap').style.display === 'none',
  rows: document.querySelectorAll('#watch-tbl tbody tr').length,
  hasAdd: !!document.querySelector('#w-target'),
  types: [...document.querySelectorAll('#w-type option')].map(o => o.value),
  firstRow: document.querySelector('#watch-tbl tbody tr')?.innerText?.replace(/\\s+/g, ' ').slice(0, 90),
  status: document.querySelector('#st-msg')?.textContent,
}))()`);
console.log(JSON.stringify(info, null, 1));
await cdp.screenshot(path.resolve("test/watch-ui.png"));
console.log("截图 test/watch-ui.png");
cdp.close();
await new Promise((r) => setTimeout(r, 300));
try { process.kill(chrome.pid); } catch {}
await new Promise((r) => setTimeout(r, 400));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
