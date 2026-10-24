import fs from 'node:fs';

// ---------- HTML: 加刷新按钮 ----------
const hf = 'web/classic.html';
let h = fs.readFileSync(hf, 'utf8');
if (!h.includes('onclick="CL.refresh()"')) {
  h = h.replace(
    '<button class="act" onclick="CL.addLink()">添加链接</button>',
    '<button class="act" onclick="CL.refresh()">刷新数据</button>\n          <button class="act" onclick="CL.addLink()">添加链接</button>'
  );
  fs.writeFileSync(hf, h);
  console.log('HTML: 刷新按钮已加');
}

// ---------- JS: 改进 poll + 加 refresh ----------
const jf = 'web/classic.js';
let j = fs.readFileSync(jf, 'utf8');

const oldPoll = `  poll() {
    clearInterval(CL.pollTimer);
    CL.pollTimer = setInterval(async () => {
      try {
        const j = await CL.api('/api/tasks?limit=5');
        const t = (j.data || [])[0];
        if (!t) return;
        if (t.status === 'running') CL.status(\`采集中 #\${t.id} \${t.type} 成功 \${t.done}\`);
        else if (t.status === 'done') { CL.status(\`完成 #\${t.id}，成功 \${t.done}\`); clearInterval(CL.pollTimer); CL.load(); }
        else if (t.status === 'failed') { CL.status(\`失败 #\${t.id} \${t.error || ''}\`); clearInterval(CL.pollTimer); }
      } catch (e) { /* 忽略 */ }
    }, 3000);
  },`;

const newPoll = `  poll(startedAt = Date.now()) {
    clearInterval(CL.pollTimer);
    let idleTicks = 0;
    CL.pollTimer = setInterval(async () => {
      try {
        const j = await CL.api('/api/tasks?limit=15');
        // 只看本次采集开始之后新建的任务
        const mine = (j.data || []).filter((t) => Number(t.created_at || 0) >= startedAt - 5000);
        const active = mine.filter((t) => t.status === 'running' || t.status === 'queued');
        const failed = mine.filter((t) => t.status === 'failed');

        if (active.length) {
          idleTicks = 0;
          const d = active.reduce((a, t) => a + (t.done || 0), 0);
          CL.status(\`采集中：\${active.length} 个任务，已采 \${d} 条…\`);
          return;
        }

        idleTicks++;
        // 任务可能还没入队，等两个周期再判定结束
        if (idleTicks < 2) return;

        clearInterval(CL.pollTimer);
        const done = mine.reduce((a, t) => a + (t.done || 0), 0);
        await CL.load();
        if (failed.length) {
          CL.toast(\`有 \${failed.length} 个任务失败：\${failed[0].error || ''}\`, 'warn', 6000);
          CL.status(\`完成（\${failed.length} 个失败）\`);
        } else {
          CL.toast(\`采集完成，共 \${done} 条，列表已刷新\`, 'ok', 5000);
          CL.status(\`采集完成，共 \${done} 条\`);
        }
      } catch (e) { /* 忽略 */ }
    }, 3000);
  },

  async refresh() {
    CL.status('刷新中…');
    await CL.load();
    const n = CL.rows.length;
    CL.toast(\`已刷新，当前 \${n} 条\`, 'ok');
    CL.status(\`\${MODS[CL.mod]?.title || ''}：\${n} 条\`);
  },`;

if (j.includes(oldPoll)) {
  j = j.replace(oldPoll, newPoll);
  console.log('JS: poll 已重写，refresh 已加');
} else {
  console.log('JS: poll 未匹配');
}

// start() 里调用 poll 时传入时间戳
j = j.replace(/CL\.poll\(\);/g, 'CL.poll(Date.now());');

fs.writeFileSync(jf, j);
console.log('done');
