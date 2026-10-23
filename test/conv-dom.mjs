/** 从消息页 DOM 提取会话列表 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const PORT = 9301;
const t = (await listTargets(PORT)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate('https://www.douyin.com/user/self?showTab=message', { waitMs: 7000 });
await new Promise((r) => setTimeout(r, 6000));

const data = await cdp.evaluate(`(() => {
  const items = [...document.querySelectorAll('[class*="ConversationItem"], [class*="conversationItem"]')]
    .filter(e => !e.className.toString().includes('row') && (e.innerText || '').trim().length > 0);
  const outer = [...new Set(items.map(e => e.className.toString()))].slice(0, 6);
  const rows = items.slice(0, 20).map(e => ({
    cls: e.className.toString().slice(0, 60),
    text: (e.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
  }));
  return { count: items.length, classes: outer, rows };
})()`);
console.log(JSON.stringify(data, null, 1));

// 更细：找最外层会话项容器
const list = await cdp.evaluate(`(() => {
  const cand = [...document.querySelectorAll('div')].filter(d => /ConversationItem(?!rowArea|title)/.test(d.className.toString()));
  const withChildren = cand.filter(d => d.children.length >= 2 && (d.innerText || '').trim().length > 2);
  return withChildren.slice(0, 6).map(d => ({
    cls: d.className.toString().slice(0, 80),
    childCls: [...d.children].map(c => c.className.toString().slice(0, 40)),
    text: (d.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 100),
  }));
})()`);
console.log('容器:', JSON.stringify(list, null, 1));

await cdp.screenshot(path.resolve('test/conversations.png'));
console.log('截图 test/conversations.png');
cdp.close();
process.exit(0);
