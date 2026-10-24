import fs from 'node:fs';

const f = 'web/classic.js';
let c = fs.readFileSync(f, 'utf8');

// 1. 模块定义
if (!c.includes("live: { kind: 'lives'")) {
  c = c.replace(
    "  'video-user': { kind: 'users', keyword: false, title: '视频/用户' },",
    "  'video-user': { kind: 'users', keyword: false, title: '视频/用户' },\n  live: { kind: 'lives', keyword: false, title: '直播间' },"
  );
}

// 2. 列定义
if (!c.includes('lives: [')) {
  c = c.replace(
    "  users: ['编号', '昵称', '抖音号', 'sec_uid', '粉丝', '关注', '总获赞', '签名', '地区'],",
    "  users: ['编号', '昵称', '抖音号', 'sec_uid', '粉丝', '关注', '总获赞', '签名', '地区'],\n  lives: ['编号', '标题', '主播', '房间号', '在线', '关键词', '链接'],"
  );
}

// 3. setMod 显示采弹幕按钮
if (!c.includes("btn-danmu")) {
  c = c.replace(
    "    CL.renderHead();\n    if (isAuto) CL.loadWatches();",
    "    const danmuBtn = document.querySelector('#btn-danmu');\n    if (danmuBtn) danmuBtn.style.display = (conf.kind === 'lives') ? '' : 'none';\n    CL.renderHead();\n    if (isAuto) CL.loadWatches();"
  );
}

// 4. render 加 lives 分支
const renderAnchor = "    } else {\n      html = list.slice(0, 500).map((r, i) => `<tr>${cb(r)}<td>${i + 1}</td>";
const livesBlock = [
  "    } else if (kind === 'lives') {",
  "      html = list.slice(0, 500).map((r, i) => {",
  "        const rid = r.web_rid || r.room_id || '';",
  "        return `<tr>${cb(r)}<td>${i + 1}</td>",
  "          <td class=\"wrap\">${esc((r.title || '(无标题)').slice(0, 40))}</td>",
  "          <td>${esc(r.anchor || '')}</td>",
  "          <td>${esc(rid)}</td>",
  "          <td>${r.online || 0}</td>",
  "          <td>${esc(r.keyword || '')}</td>",
  "          <td>${esc(r.url || '')}</td></tr>`;",
  "      }).join('');",
  "    } else {",
  "      html = list.slice(0, 500).map((r, i) => `<tr>${cb(r)}<td>${i + 1}</td>",
].join('\n');
if (c.includes(renderAnchor) && !c.includes("kind === 'lives'")) {
  c = c.replace(renderAnchor, livesBlock);
}

// 5. 采弹幕方法
if (!c.includes('collectDanmu')) {
  const addBefore = "  async dmSelected() {";
  const method = [
    "  async collectDanmu() {",
    "    const picked = CL.rows.filter((r) => CL.selected.has(r.id));",
    "    if (!picked.length) return CL.toast('先在上表勾选要采的直播间', 'warn');",
    "    const rid = picked.map((r) => r.web_rid || r.room_id).filter(Boolean);",
    "    if (!rid.length) return CL.toast('选中的直播间没有房间号', 'warn');",
    "    const min = Number(prompt('监听多少分钟？', '5')) || 5;",
    "    CL.status('开始监听弹幕…');",
    "    try {",
    "      let n = 0;",
    "      for (const r of rid.slice(0, 3)) {",
    "        await CL.api('/api/tasks', { method: 'POST', body: { type: 'live_stream', params: { web_rid: r, minutes: min } } });",
    "        n++;",
    "      }",
    "      CL.toast(`已启动 ${n} 个弹幕监听，${min} 分钟后自动结束`, 'ok', 6000);",
    "      CL.status(`监听中（${min} 分钟）`);",
    "    } catch (e) { CL.toast(e.message, 'error'); }",
    "  },",
    "",
    "  async dmSelected() {",
  ].join('\n');
  c = c.replace(addBefore, method);
}

fs.writeFileSync(f, c);
console.log('classic.js 已更新');
