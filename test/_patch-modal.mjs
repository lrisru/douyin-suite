import fs from 'node:fs';

// ---------- 1. HTML: 加内嵌对话框 ----------
const hf = 'web/classic.html';
let h = fs.readFileSync(hf, 'utf8');
if (!h.includes('id="modal"')) {
  const modalCss = `
  /* 内嵌对话框（替代 prompt，避免被浏览器拦截） */
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 200; }
  .modal-box { background: #fff; border: 1px solid #b8b8b8; border-radius: 3px; width: 420px; padding: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
  .modal-title { font-weight: 600; margin-bottom: 6px; font-size: 12px; }
  .modal-box textarea { width: 100%; height: 96px; border: 1px solid #b8b8b8; padding: 4px 6px; font-size: 12px; resize: vertical; font-family: inherit; }
  .modal-btns { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
  .modal-btns button { padding: 4px 14px; border: 1px solid #adadad; background: #f7f7f7; cursor: pointer; font-size: 12px; }
  .modal-btns button.ok { background: #2b7fb8; color: #fff; border-color: #2b7fb8; }
`;
  h = h.replace('</style>', modalCss + '</style>');
  h = h.replace('<div class="toast-box" id="toast"></div>',
    `<div class="modal" id="modal" style="display:none">
    <div class="modal-box">
      <div class="modal-title" id="modal-title"></div>
      <textarea id="modal-input"></textarea>
      <div class="modal-btns">
        <button onclick="CL.modalClose(null)">取消</button>
        <button class="ok" onclick="CL.modalClose(document.querySelector('#modal-input').value)">确定</button>
      </div>
    </div>
  </div>
  <div class="toast-box" id="toast"></div>`);
  fs.writeFileSync(hf, h);
  console.log('HTML: 对话框已加');
}

// ---------- 2. JS: ask() + 替换 prompt ----------
const jf = 'web/classic.js';
let j = fs.readFileSync(jf, 'utf8');

if (!j.includes('ask(title')) {
  const askMethod = `
  /** 页面内输入框，替代 prompt（Chrome 会拦原生弹窗） */
  ask(title, defaultValue = '') {
    return new Promise((resolve) => {
      const box = document.querySelector('#modal');
      document.querySelector('#modal-title').textContent = title;
      const input = document.querySelector('#modal-input');
      input.value = defaultValue;
      box.style.display = 'flex';
      input.focus();
      input.select();
      CL._modalResolve = resolve;
    });
  },

  modalClose(val) {
    document.querySelector('#modal').style.display = 'none';
    const r = CL._modalResolve;
    CL._modalResolve = null;
    if (r) r(val);
  },
`;
  j = j.replace('  toast(msg, type = \'info\', ms = 4000) {', askMethod + '\n  toast(msg, type = \'info\', ms = 4000) {');
}

// 替换所有 await prompt / const x = prompt
j = j.replace(/const (\w+) = prompt\(([^;]+?)\);/g, 'const $1 = await CL.ask($2);');
j = j.replace(/const n = prompt\(([^;]+?)\);/g, 'const n = await CL.ask($1);');
j = j.replace(/const min = Number\(prompt\(([^)]+)\)\) \|\| 5;/g, 'const min = Number(await CL.ask($1, "5")) || 5;');

// ---------- 3. 「全部删除」改成真删除选中 ----------
j = j.replace(
  '<button class="act" onclick="CL.clearFilter()">全部删除</button>',
  '<button class="act" onclick="CL.deleteSelected()">删除选中</button>'
);
// HTML 里也要改
h = fs.readFileSync(hf, 'utf8');
if (h.includes('>全部删除<')) {
  h = h.replace('onclick="CL.clearFilter()">全部删除<', 'onclick="CL.deleteSelected()">删除选中<');
  h = h.replace('onclick="CL.clearFilter()">全部删除', 'onclick="CL.deleteSelected()">删除选中');
  fs.writeFileSync(hf, h);
  console.log('HTML: 全部删除 -> 删除选中');
}

if (!j.includes('deleteSelected()')) {
  const delMethod = `
  /** 删除当前勾选的行（真删库） */
  async deleteSelected() {
    const ids = [...CL.selected];
    if (!ids.length) return CL.toast('先勾选要删除的行', 'warn');
    const ok = await CL.ask(\`确认删除 \${ids.length} 条？此操作不可恢复（输入 ok 继续）\`, '');
    if (String(ok || '').trim().toLowerCase() !== 'ok') return CL.toast('已取消', 'info');
    try {
      const r = await CL.api('/api/data/delete', { method: 'POST', body: { kind: CL.kind || 'comments', ids } });
      CL.selected.clear();
      CL.toast(\`已删除 \${r.data?.deleted || ids.length} 条\`, 'ok');
      await CL.load();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

`;
  j = j.replace('  async refresh() {', delMethod + '  async refresh() {');
}

fs.writeFileSync(jf, j);
console.log('JS: ask/deleteSelected 已加，prompt 已替换');
