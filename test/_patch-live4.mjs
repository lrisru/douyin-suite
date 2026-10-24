import fs from 'node:fs';

const f = 'web/classic.js';
let c = fs.readFileSync(f, 'utf8');

// 1) start(): 识别直播间链接，按当前模块创建对应任务
const oldStart = `  async start() {
    const links = CL.parseLinks();
    if (!links.length) return CL.toast('先填链接', 'warn');

    const awemeIds = [];
    const secUids = [];
    for (const l of links) {
      const m1 = l.match(/(?:\\/video\\/|modal_id=)(\\d{8,})/);
      const m2 = l.match(/\\/user\\/(MS4w[A-Za-z0-9_-]+)/);
      if (m1) awemeIds.push(m1[1]);
      else if (m2) secUids.push(m2[1]);
      else if (/^\\d{8,}$/.test(l)) awemeIds.push(l);
      else if (/^MS4w/.test(l)) secUids.push(l);
    }

    if (!awemeIds.length && !secUids.length) return CL.toast('没从链接里认出作品/用户 ID', 'error');
`;

const newStart = `  async start() {
    const links = CL.parseLinks();
    if (!links.length) return CL.toast('先填链接', 'warn');

    const awemeIds = [];
    const secUids = [];
    const liveRids = [];
    for (const l of links) {
      const mLive = l.match(/live\\.douyin\\.com\\/(?:name\\/)?(\\d{6,})/);
      const m1 = l.match(/(?:\\/video\\/|modal_id=)(\\d{8,})/);
      const m2 = l.match(/\\/user\\/(MS4w[A-Za-z0-9_-]+)/);
      if (mLive) liveRids.push(mLive[1]);
      else if (m1) awemeIds.push(m1[1]);
      else if (m2) secUids.push(m2[1]);
      else if (/^\\d{8,}$/.test(l)) awemeIds.push(l);
      else if (/^MS4w/.test(l)) secUids.push(l);
    }

    // 直播间模块：直接按房间号采直播信息
    if (CL.kind === 'lives' && liveRids.length) {
      CL.status('采集中…');
      let n = 0;
      try {
        for (const rid of liveRids.slice(0, 5)) {
          await CL.api('/api/tasks', { method: 'POST', body: { type: 'live', params: { web_rid: rid } } });
          n++;
        }
        CL.toast(\`已建 \${n} 个直播采集任务\`, 'ok');
        CL.poll();
      } catch (e) { CL.toast(e.message, 'error'); }
      return;
    }

    if (!awemeIds.length && !secUids.length && !liveRids.length) {
      return CL.toast('没从链接里认出作品/用户/直播间 ID', 'error');
    }
`;

if (!c.includes(oldStart)) {
  console.log('start() 未匹配，尝试宽松替换');
} else {
  c = c.replace(oldStart, newStart);
  console.log('start() 已更新');
}

// 2) render lives 分支：链接列显示 live.douyin.com/房间号
c = c.replace(
  "          <td>${esc(r.url || '')}</td></tr>`;",
  "          <td>${rid ? `live.douyin.com/${rid}` : ''}</td></tr>`;"
);

fs.writeFileSync(f, c);
console.log('done');
