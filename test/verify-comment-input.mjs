/** 评论输入验证（dryRun 只输入不发送） */
import { Cdp, listTargets } from '../src/cdp.js';
import { DouyinService } from '../src/douyin.js';
import { loadConfig } from '../src/util.js';

const AWEME = process.argv[2] || '7648597554959109402';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

const cfg = loadConfig(process.cwd());
const host = {
  page: async (acc, url) => { if (url) await cdp.navigate(url, { waitMs: 2500 }); return { cdp }; },
  checkLogin: async () => ({ loggedIn: true }),
};
const douyin = new DouyinService(host, cfg);

const r = await douyin.comment({ id: 9 }, { awemeId: AWEME, text: '自检输入测试', dryRun: true });
console.log('结果:', JSON.stringify(r));

// 清空输入框，别留下半截文字
await cdp.evaluate(`(() => {
  const box = document.querySelector('div.comment-input-inner-container');
  const el = box && box.querySelector('[contenteditable="true"], textarea, input');
  if (el) { el.innerText = ''; if ('value' in el) el.value = ''; }
})()`);

console.log(r.ok ? 'PASS 评论输入可用' : 'FAIL 输入未生效');
cdp.close();
process.exit(r.ok ? 0 : 1);
