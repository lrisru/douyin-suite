/** 诊断用户页的私信入口 */
import path from 'node:path';
import { Cdp, listTargets } from '../src/cdp.js';

const SEC = process.argv[2] || 'MS4wLjABAAAABNDbPqQjEYjIkwuSYzpeuuXaN3fjabcOFEtNjkI9JLU';
const t = (await listTargets(9301)).find((x) => x.type === 'page');
const cdp = await Cdp.connect(t.webSocketDebuggerUrl);
await cdp.enable();

await cdp.navigate(`https://www.douyin.com/user/${SEC}`, { waitMs: 8000 });
await new Promise((r) => setTimeout(r, 3000));

const info = await cdp.evaluate(`(() => {
  const btns = [...document.querySelectorAll('button, [role="button"], div, span')]
    .filter(e => {
      const txt = (e.innerText || '').trim();
      return txt && txt.length <= 6 && e.getBoundingClientRect().width > 0;
    })
    .map(e => ({ txt: (e.innerText || '').trim(), tag: e.tagName, cls: (e.className || '').toString().slice(0, 40), e2e: e.getAttribute('data-e2e') || '' }))
    .filter((v, i, a) => a.findIndex(x => x.txt === v.txt && x.tag === v.tag) === i)
    .slice(0, 20);
  return {
    url: location.href.slice(0, 60),
    title: document.title,
    notExist: /用户不存在/.test(document.body.innerText || ''),
    hasDm: /私信/.test(document.body.innerText || ''),
    btns,
  };
})()`);
console.log(JSON.stringify(info, null, 1));

await cdp.screenshot(path.resolve('test/dm-entry.png'));
console.log('截图 test/dm-entry.png');
cdp.close();
process.exit(0);
