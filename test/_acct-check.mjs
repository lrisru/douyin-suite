import { Cdp, listTargets } from "../src/cdp.js";
const t = (await listTargets(9301)).find(x => x.type === "page");
if (!t) { console.log("浏览器没起来"); process.exit(1); }
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();
const s = await cdp.evaluate(`(() => ({
  url: location.href.slice(0, 50),
  hasWarning: /不受支持的命令行标记/.test(document.body.innerText || ""),
  webdriver: navigator.webdriver,
}))()`);
console.log("账号浏览器:", JSON.stringify(s));
await cdp.screenshot("test/account-browser.png");
console.log("截图 test/account-browser.png");
cdp.close();
process.exit(0);
