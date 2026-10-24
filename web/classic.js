/* 经典界面（仿原版布局）逻辑 */
const CL = {
  rows: [],
  filtered: [],
  selected: new Set(),
  screenTimer: null,
  mod: 'comments',

  async api(path, opts = {}) {
    const r = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  },

  toast(msg, type = 'info', ms = 4000) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.querySelector('#toast').appendChild(el);
    setTimeout(() => el.remove(), ms);
  },

  status(msg) { document.querySelector('#st-msg').textContent = msg; },

  /* ---------- 左侧浏览器画面 ---------- */
  startScreen(live = true) {
    const img = document.querySelector('#screen');
    const ph = document.querySelector('#screen-ph');
    const tick = async () => {
      try {
        const j = await CL.api('/api/screen');
        if (j.data?.image) {
          img.src = j.data.image;
          img.style.display = '';
          ph.style.display = 'none';
          if (j.data.url) document.querySelector('#url').value = j.data.url;
        }
      } catch (e) { /* 忽略 */ }
    };
    tick();
    if (live) CL.screenTimer = setInterval(tick, 2500);
  },

  async openUrl() {
    const url = document.querySelector('#url').value.trim();
    if (!url) return CL.toast('先填地址', 'warn');
    CL.status('打开中…');
    try {
      await CL.api('/api/navigate', { method: 'POST', body: { url } });
      setTimeout(() => CL.startScreen(false), 1500);
      CL.status('已打开 ' + url);
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  grabCurrent() {
    const url = document.querySelector('#url').value.trim();
    document.querySelector('#links').value = url;
    CL.toast('已把当前地址填入链接框，点「开始采集」', 'ok');
  },

  /* ---------- 链接 ---------- */
  addLink() {
    const cur = document.querySelector('#links').value.trim();
    if (!cur) return CL.toast('先在地址栏或框里填链接', 'warn');
    document.querySelector('#links').value = cur + '\n';
  },
  clearLinks() { document.querySelector('#links').value = ''; },

  parseLinks() {
    return document.querySelector('#links').value.split(/[\s,，;；]+/).map((s) => s.trim()).filter(Boolean);
  },

  /* ---------- 采集 ---------- */
  async start() {
    const links = CL.parseLinks();
    if (!links.length) return CL.toast('先填链接', 'warn');

    const awemeIds = [];
    const secUids = [];
    for (const l of links) {
      const m1 = l.match(/(?:\/video\/|modal_id=)(\d{8,})/);
      const m2 = l.match(/\/user\/(MS4w[A-Za-z0-9_-]+)/);
      if (m1) awemeIds.push(m1[1]);
      else if (m2) secUids.push(m2[1]);
      else if (/^\d{8,}$/.test(l)) awemeIds.push(l);
      else if (/^MS4w/.test(l)) secUids.push(l);
    }

    if (!awemeIds.length && !secUids.length) return CL.toast('没从链接里认出作品/用户 ID', 'error');

    CL.status('任务创建中…');
    try {
      let n = 0;
      if (CL.mod === 'comments' && awemeIds.length) {
        await CL.api('/api/tasks', { method: 'POST', body: { type: 'comments', params: { aweme_ids: awemeIds, limit: 300 } } });
        n++;
      }
      if (awemeIds.length && CL.mod !== 'comments') {
        await CL.api('/api/tasks', { method: 'POST', body: { type: 'download', params: { aweme_ids: awemeIds } } });
        n++;
      }
      if (secUids.length) {
        await CL.api('/api/tasks', { method: 'POST', body: { type: 'user_works', params: { sec_uid: secUids[0], limit: 100 } } });
        n++;
      }
      CL.toast(`已创建 ${n} 个任务，跑到「日志」看进度`, 'ok');
      CL.status('采集中…');
      CL.poll();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async stop() {
    try {
      const j = await CL.api('/api/tasks?limit=20');
      const running = (j.data || []).filter((t) => t.status === 'running' || t.status === 'queued');
      for (const t of running) await CL.api(`/api/tasks/${t.id}`, { method: 'POST', body: { cancel: true } }).catch(() => {});
      CL.toast(`已停止 ${running.length} 个任务`, 'ok');
      CL.status('已停止');
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  poll() {
    clearInterval(CL.pollTimer);
    CL.pollTimer = setInterval(async () => {
      try {
        const j = await CL.api('/api/tasks?limit=5');
        const t = (j.data || [])[0];
        if (!t) return;
        if (t.status === 'running') CL.status(`采集中 #${t.id} ${t.type} 成功 ${t.done}`);
        else if (t.status === 'done') { CL.status(`完成 #${t.id}，成功 ${t.done}`); clearInterval(CL.pollTimer); CL.load(); }
        else if (t.status === 'failed') { CL.status(`失败 #${t.id} ${t.error || ''}`); clearInterval(CL.pollTimer); }
      } catch (e) { /* 忽略 */ }
    }, 3000);
  },

  /* ---------- 备份 ---------- */
  async backup() {
    try {
      const j = await CL.api('/api/data/comments?limit=5000');
      localStorage.setItem('dy_backup_comments', JSON.stringify(j.data || []));
      CL.toast(`已备份 ${j.data.length} 条到浏览器本地`, 'ok');
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async restore() {
    const raw = localStorage.getItem('dy_backup_comments');
    if (!raw) return CL.toast('没有备份', 'warn');
    try {
      const arr = JSON.parse(raw);
      CL.rows = arr;
      CL.render(arr);
      CL.toast(`已恢复 ${arr.length} 条（仅界面展示）`, 'ok');
    } catch (e) { CL.toast('备份损坏', 'error'); }
  },

  /* ---------- 数据 ---------- */
  async load() {
    try {
      const j = await CL.api('/api/data/comments?limit=1000');
      CL.rows = j.data || [];
      document.querySelector('#st-total').textContent = j.total ?? CL.rows.length;
      CL.applyFilter();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  applyFilter() {
    const city = document.querySelector('#f-city').value.trim();
    const gender = document.querySelector('#f-gender').value;
    const contain = document.querySelector('#f-contain').value.trim();
    const exclude = document.querySelector('#f-exclude').value.trim();
    const dateFrom = document.querySelector('#f-date').value;
    const dedupUser = document.querySelector('#f-dedup-user').checked;

    let list = [...CL.rows];

    if (city) list = list.filter((r) => (r.user_city || '').includes(city));
    if (gender) list = list.filter((r) => String(r.user_gender || 0) === gender);
    if (contain) list = list.filter((r) => (r.text || '').includes(contain));
    if (exclude) list = list.filter((r) => !(r.text || '').includes(exclude));
    if (dateFrom) {
      const t0 = new Date(dateFrom + 'T00:00:00').getTime();
      list = list.filter((r) => (r.create_time ? r.create_time * 1000 >= t0 : true));
    }
    if (dedupUser) {
      const seen = new Set();
      list = list.filter((r) => {
        const k = r.user_uid || r.user_sec_uid || r.user_name;
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    CL.filtered = list;
    CL.render(list);
    CL.status(`筛选结果 ${list.length} / ${CL.rows.length}`);
  },

  clearFilter() {
    ['f-city', 'f-contain', 'f-exclude', 'f-date'].forEach((id) => { const el = document.querySelector('#' + id); if (el) el.value = ''; });
    document.querySelector('#f-gender').value = '';
    document.querySelector('#f-dedup-user').checked = false;
    CL.applyFilter();
  },

  /* ---------- 渲染 ---------- */
  render(list) {
    const tb = document.querySelector('#tbl tbody');
    const genderText = (g) => (g === 1 ? '男' : g === 2 ? '女' : '');
    tb.innerHTML = list.slice(0, 500).map((r, i) => {
      const checked = CL.selected.has(r.id) ? 'checked' : '';
      const link = r.aweme_id ? `https://www.douyin.com/video/${r.aweme_id}` : '';
      const time = r.create_time ? new Date(r.create_time * 1000).toLocaleDateString() : '';
      return `<tr>
        <td><input type="checkbox" data-id="${r.id}" ${checked} onchange="CL.toggleSel(${r.id}, this.checked)"></td>
        <td>${i + 1}</td>
        <td title="${link}">${link ? 'douyin.com/video/' + r.aweme_id : ''}</td>
        <td>${time}</td>
        <td>${esc(r.user_name || '')}</td>
        <td class="wrap">${esc(r.text || '')}</td>
        <td>${r.user_uid || ''}</td>
        <td>${esc(r.user_douyin_id || '')}</td>
        <td>${genderText(r.user_gender)}</td>
        <td>${esc(r.user_city || '')}</td>
        <td class="wrap">${esc((r.user_signature || '').slice(0, 20))}</td>
        <td>${r.user_followers || ''}</td>
        <td>${r.user_following || ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="13" style="text-align:center;color:#888;padding:20px">没有数据</td></tr>';
    document.querySelector('#st-sel').textContent = CL.selected.size;
  },

  toggleSel(id, on) {
    if (on) CL.selected.add(id); else CL.selected.delete(id);
    document.querySelector('#st-sel').textContent = CL.selected.size;
  },

  selectAll() {
    const boxes = [...document.querySelectorAll('#tbl tbody input[type=checkbox]')];
    const allOn = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !allOn; CL.toggleSel(Number(b.dataset.id), !allOn); });
  },

  /* ---------- 导出 / 导入 / 私信 ---------- */
  exportExcel() {
    const city = document.querySelector('#f-city').value.trim();
    const q = new URLSearchParams({ kind: 'comments', format: 'xlsx' });
    if (city) q.set('keyword', city);
    window.open('/api/export?' + q.toString(), '_blank');
  },

  importExcel() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      const text = await f.text();
      const links = text.split(/[\r\n,，]+/).map((s) => s.trim()).filter((s) => /douyin\.com|^\d{8,}$|^MS4w/.test(s));
      document.querySelector('#links').value = links.join('\n');
      CL.toast(`已导入 ${links.length} 条链接到采集框`, 'ok');
    };
    input.click();
  },

  async enrich() {
    const n = prompt('补全多少个评论者资料？（性别/城市/简介/粉丝，约 0.8 秒/个）', '50');
    if (n === null) return;
    CL.status('补全中…');
    try {
      const j = await CL.api('/api/enrich', { method: 'POST', body: { limit: Number(n) || 50 } });
      CL.toast(`补全完成：成功 ${j.data.ok} 失败 ${j.data.fail}`, 'ok');
      CL.status('补全完成');
      CL.load();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async dmSelected() {
    if (!CL.selected.size) return CL.toast('先勾选要私信的人', 'warn');
    const secs = [...new Set(CL.rows.filter((r) => CL.selected.has(r.id)).map((r) => r.user_sec_uid).filter(Boolean))];
    if (!secs.length) return CL.toast('选中的人没有 sec_uid，先点「补全评论者资料」', 'warn');
    const text = prompt(`向 ${secs.length} 人发私信。话术（多条用 | 分隔）：`, '看到您在问贴膜，什么车型？我按车型给您报个实在价');
    if (text === null) return;
    try {
      const texts = text.split('|').map((s) => s.trim()).filter(Boolean);
      const j = await CL.api('/api/tasks', { method: 'POST', body: { type: 'dm', params: { sec_uids: secs, texts } } });
      CL.toast(`已建私信任务 #${j.data.id}，共 ${secs.length} 人`, 'ok', 6000);
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  /* ---------- 菜单 ---------- */
  setMod(mod) {
    CL.mod = mod;
    document.querySelectorAll('.menubar [data-mod]').forEach((b) => b.classList.toggle('active', b.dataset.mod === mod));
    CL.load();
  },

  showQr() {
    window.open('/api/screen', '_blank');
  },

  async boot() {
    document.querySelectorAll('.menubar [data-mod]').forEach((b) => {
      b.addEventListener('click', () => CL.setMod(b.dataset.mod));
    });
    document.querySelector('#f-live').addEventListener('change', (e) => {
      if (e.target.checked) CL.liveTimer = setInterval(CL.load, 15000);
      else clearInterval(CL.liveTimer);
    });
    CL.startScreen(true);
    await CL.load();
    try {
      const s = await CL.api('/api/stats');
      const parts = [`作品 ${s.data.items}`, `评论 ${s.data.comments}`, `用户 ${s.data.users}`];
      document.querySelector('#st-acct').textContent = parts.join('　');
    } catch (e) { /* 忽略 */ }
  },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

CL.boot();
