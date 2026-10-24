import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from "../src/cdp.js";

const port = 9396;
const profile = path.join(os.tmpdir(), "dy-dbg2");
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
launchChrome({ chromePath: findChrome({}), profileDir: profile, port, headless: true, width: 1400, height: 900 });
const ep = await waitEndpoint(port, 20000);
const cdp = await Cdp.connect((await newTab(port, "http://127.0.0.1:9527/classic.html")).webSocketDebuggerUrl);
await cdp.enable();
await new Promise((r) => setTimeout(r, 4000));

const probe = await cdp.evaluate(`(async () => {
  const out = {};
  try {
    const r = await fetch('/api/data/comments?limit=5');
    out.httpStatus = r.status;
    const j = await r.json();
    out.ok = j.ok;
    out.total = j.total;
    out.rows = (j.data || []).length;
  } catch (e) { out.fetchError = String(e); }
  try {
    await CL.load();
    out.afterLoad = document.querySelectorAll('#tbl tbody tr').length;
    out.totalAfter = document.querySelector('#st-total').textContent;
  } catch (e) { out.loadError = String(e); }
  return out;
})()`);
console.log(JSON.stringify(probe, null, 1));
cdp.close();
await new Promise((r) => setTimeout(r, 300));
try { process.kill(chrome.pid); } catch {}
await new Promise((r) => setTimeout(r, 400));
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
