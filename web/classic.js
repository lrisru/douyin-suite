/* 经典界面（仿原版布局）逻辑 */
const MODS = {
  'search-video': { kind: 'items', keyword: true, title: '搜索视频' },
  comments: { kind: 'comments', keyword: false, title: '视频评论' },
  group: { kind: 'users', keyword: false, title: '群成员' },
  'video-user': { kind: 'users', keyword: false, title: '视频/用户' },
  live: { kind: 'lives', keyword: false, title: '直播间' },
  auto: { kind: null, keyword: false, title: '自动化操作区' },
};

const COLS = {
  items: ['编号', '标题', '链接', '作者', '点赞', '评论', '收藏', '分享', '发布时间'],
  comments: ['编号', '链接', '时间', '昵称', '评论内容', 'UID', '抖音号', '性别', '地区', '简介', '粉丝', '关注'],
  users: ['编号', '昵称', '抖音号', 'sec_uid', '粉丝', '关注', '总获赞', '签名', '地区'],
  lives: ['编号', '标题', '主播', '房间号', '在线', '关键词', '链接'],
};

const CL = {
  kind: 'comments',
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

  async home() {
    document.querySelector('#url').value = 'https://www.douyin.com';
    await CL.openUrl();
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
    CL.status('备份中…');
    try {
      const j = await CL.api('/api/backup', { method: 'POST' });
      const c = j.data.counts;
      CL.toast(`已备份到文件：作品${c.items} 用户${c.users} 评论${c.comments}`, 'ok', 6000);
      CL.status('备份完成 ' + j.data.file);
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async restore() {
    try {
      const j = await CL.api('/api/backups');
      const files = j.data || [];
      if (!files.length) return CL.toast('还没有备份文件', 'warn');
      const latest = files[0];
      if (!confirm(`从最新备份恢复？\n${latest.file}\n${(latest.size / 1048576).toFixed(1)} MB`)) return;
      CL.status('恢复中…');
      const r = await CL.api('/api/restore', { method: 'POST', body: { file: 'data/backups/' + latest.file } });
      CL.toast(`已恢复 ${r.data.restored} 条记录`, 'ok', 6000);
      await CL.load();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  /* ---------- 数据 ---------- */
  async load() {
    const kind = CL.kind || 'comments';
    try {
      const j = await CL.api(`/api/data/${kind}?limit=1000`);
      CL.rows = j.data || [];
      document.querySelector('#st-total').textContent = j.total ?? CL.rows.length;
      if (kind === 'comments') CL.applyFilter();
      else { CL.filtered = CL.rows; CL.render(CL.rows); CL.status(`${MODS[CL.mod]?.title || kind}：${j.total} 条`); }
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
    const kind = CL.kind || 'comments';
    const cb = (r) => `<td><input type="checkbox" data-id="${r.id}" ${CL.selected.has(r.id) ? 'checked' : ''} onchange="CL.toggleSel(${r.id}, this.checked)"></td>`;

    let html = '';
    if (kind === 'comments') {
      const genderText = (g) => (g === 1 ? '男' : g === 2 ? '女' : '');
      html = list.slice(0, 500).map((r, i) => {
        const link = r.aweme_id ? `douyin.com/video/${r.aweme_id}` : '';
        const time = r.create_time ? new Date(r.create_time * 1000).toLocaleDateString() : '';
        return `<tr>${cb(r)}<td>${i + 1}</td><td>${link}</td><td>${time}</td>
          <td>${esc(r.user_name || '')}</td><td class="wrap">${esc(r.text || '')}</td>
          <td>${r.user_uid || ''}</td><td>${esc(r.user_douyin_id || '')}</td>
          <td>${genderText(r.user_gender)}</td><td>${esc(r.user_city || '')}</td>
          <td class="wrap">${esc((r.user_signature || '').slice(0, 20))}</td>
          <td>${r.user_followers || ''}</td><td>${r.user_following || ''}</td></tr>`;
      }).join('');
    } else if (kind === 'items') {
      html = list.slice(0, 500).map((r, i) => {
        const link = r.aweme_id ? `douyin.com/video/${r.aweme_id}` : '';
        const time = r.create_time ? new Date(r.create_time * 1000).toLocaleDateString() : '';
        return `<tr>${cb(r)}<td>${i + 1}</td>
          <td class="wrap">${esc((r.desc || '').slice(0, 40))}</td>
          <td>${link}</td><td>${esc(r.author || '')}</td>
          <td>${fmtNum(r.digg)}</td><td>${fmtNum(r.comment)}</td>
          <td>${fmtNum(r.collect)}</td><td>${fmtNum(r.share)}</td><td>${time}</td></tr>`;
      }).join('');
    } else if (kind === 'lives') {
      html = list.slice(0, 500).map((r, i) => {
        const rid = r.web_rid || r.room_id || '';
        return `<tr>${cb(r)}<td>${i + 1}</td>
          <td class="wrap">${esc((r.title || '(无标题)').slice(0, 40))}</td>
          <td>${esc(r.anchor || '')}</td>
          <td>${esc(rid)}</td>
          <td>${r.online || 0}</td>
          <td>${esc(r.keyword || '')}</td>
          <td>${esc(r.url || '')}</td></tr>`;
      }).join('');
    } else {
      html = list.slice(0, 500).map((r, i) => `<tr>${cb(r)}<td>${i + 1}</td>
        <td>${esc(r.nickname || '')}</td><td>${esc(r.unique_id || '')}</td>
        <td title="${esc(r.sec_uid || '')}">${esc((r.sec_uid || '').slice(0, 16))}</td>
        <td>${r.follower_count || 0}</td><td>${r.following_count || 0}</td>
        <td>${r.total_favorited || 0}</td>
        <td class="wrap">${esc((r.signature || '').slice(0, 22))}</td>
        <td>${esc(r.ip_location || '')}</td></tr>`).join('');
    }

    const span = (COLS[kind] || COLS.comments).length + 1;
    tb.innerHTML = html || `<tr><td colspan="${span}" style="text-align:center;color:#888;padding:20px">没有数据</td></tr>`;
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

  async genScript() {
    // 优先用选中的评论自动反推车型/预算/城市
    let car = '';
    let budget = '';
    let city = '';
    if (CL.selected.size) {
      const row = CL.rows.find((r) => CL.selected.has(r.id));
      if (row) {
        const p = await CL.api('/api/parse-intent', { method: 'POST', body: { text: row.text || '' } });
        car = p.data.car || '';
        budget = p.data.budget || '';
        city = row.user_city || p.data.city || '';
      }
    }
    const input = prompt('车型 / 预算 / 城市（用空格分隔，可从选中评论自动带出）', [car, budget, city].filter(Boolean).join(' '));
    if (input === null) return;
    const parts = input.trim().split(/\s+/);
    CL.status('生成中…');
    try {
      const j = await CL.api('/api/generate', { method: 'POST', body: { type: 'dm', car: parts[0] || '', budget: parts[1] || '', city: parts[2] || '', count: 3 } });
      const text = j.data.items.map((x, i) => `${i + 1}. ${x}`).join('\n');
      const pick = prompt(`生成 3 条（复制一条去私信）：\n\n${text}\n\n修改后可直接用于私信：`, j.data.items[0]);
      if (pick) {
        document.querySelector('#links').value = '';
        CL.pendingScript = pick;
        CL.toast('话术已准备好，勾选人要私信时会用到', 'ok');
      }
      CL.status('话术已生成');
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async collectDanmu() {
    const picked = CL.rows.filter((r) => CL.selected.has(r.id));
    if (!picked.length) return CL.toast('先在上表勾选要采的直播间', 'warn');
    const rid = picked.map((r) => r.web_rid || r.room_id).filter(Boolean);
    if (!rid.length) return CL.toast('选中的直播间没有房间号', 'warn');
    const min = Number(prompt('监听多少分钟？', '5')) || 5;
    CL.status('开始监听弹幕…');
    try {
      let n = 0;
      for (const r of rid.slice(0, 3)) {
        await CL.api('/api/tasks', { method: 'POST', body: { type: 'live_stream', params: { web_rid: r, minutes: min } } });
        n++;
      }
      CL.toast(`已启动 ${n} 个弹幕监听，${min} 分钟后自动结束`, 'ok', 6000);
      CL.status(`监听中（${min} 分钟）`);
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async dmSelected() {
    if (!CL.selected.size) return CL.toast('先勾选要私信的人', 'warn');
    const secs = [...new Set(CL.rows.filter((r) => CL.selected.has(r.id)).map((r) => r.user_sec_uid).filter(Boolean))];
    if (!secs.length) return CL.toast('选中的人没有 sec_uid，先点「补全评论者资料」', 'warn');
    const text = prompt(`向 ${secs.length} 人发私信。话术（多条用 | 分隔）：`, CL.pendingScript || '看到您在问贴膜，什么车型？我按车型给您报个实在价');
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
    const conf = MODS[mod] || MODS.comments;
    CL.kind = conf.kind;
    document.querySelectorAll('.menubar [data-mod]').forEach((b) => b.classList.toggle('active', b.dataset.mod === mod));

    const isAuto = mod === 'auto';
    document.querySelector('#watch-panel').style.display = isAuto ? '' : 'none';
    document.querySelector('#search-area').style.display = conf.keyword ? '' : 'none';
    document.querySelector('.links-area:not(#search-area)').style.display = (isAuto || conf.keyword) ? 'none' : '';
    // 筛选区是评论专用的，视频/用户模块不显示
    document.querySelector('.filter').style.display = (isAuto || conf.kind !== 'comments') ? 'none' : '';
    document.querySelector('.table-wrap').style.display = isAuto ? 'none' : '';
    // 评论才有筛选；视频/用户保留但只让地区/关键词生效
    const danmuBtn = document.querySelector('#btn-danmu');
    if (danmuBtn) danmuBtn.style.display = (conf.kind === 'lives') ? '' : 'none';
    CL.renderHead();
    if (isAuto) CL.loadWatches();
    else CL.load();
    CL.status(conf.title);
  },

  renderHead() {
    const cols = COLS[CL.kind] || COLS.comments;
    document.querySelector('#tbl thead').innerHTML = '<tr><th style="width:22px"></th>' + cols.map((c) => `<th>${c}</th>`).join('') + '</tr>';
  },

  async searchVideo() {
    const kw = document.querySelector('#kw').value.trim();
    const limit = Number(document.querySelector('#kw-limit').value) || 20;
    if (!kw) return CL.toast('先填关键词', 'warn');
    CL.status('搜索中…');
    try {
      const j = await CL.api('/api/tasks', { method: 'POST', body: { type: 'search_video', params: { keyword: kw, limit } } });
      CL.toast(`已建搜索任务 #${j.data.id}，跑完自动刷新`, 'ok');
      CL.poll();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async loadItems() {
    CL.kind = 'items';
    CL.renderHead();
    await CL.load();
  },

  /* ---------- 监控 ---------- */
  async loadWatches() {
    try {
      const j = await CL.api('/api/watches');
      const list = j.data || [];
      const tb = document.querySelector('#watch-tbl tbody');
      const typeName = (t) => (t === 'user_new_works' ? '博主新作品' : t === 'video_new_comments' ? '视频新评论' : t);
      tb.innerHTML = list.map((w) => `<tr>
        <td>${w.id}</td>
        <td>${typeName(w.type)}</td>
        <td title="${esc(w.target)}">${esc(String(w.target).slice(0, 22))}</td>
        <td>${esc(w.note || '')}</td>
        <td>${w.interval_sec}s</td>
        <td>${w.last_check ? new Date(w.last_check).toLocaleTimeString() : '未检查'}</td>
        <td>${w.hits || 0}</td>
        <td>
          <button class="act" style="padding:0 6px" onclick="CL.checkWatch(${w.id})">立即查</button>
          <button class="act" style="padding:0 6px" onclick="CL.delWatch(${w.id})">删除</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:#888;padding:10px">还没有监控项</td></tr>';
      document.querySelector('#st-total').textContent = list.length;
      CL.status(`监控 ${list.length} 项`);
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async addWatch() {
    const type = document.querySelector('#w-type').value;
    let target = document.querySelector('#w-target').value.trim();
    const note = document.querySelector('#w-note').value.trim();
    const interval = Number(document.querySelector('#w-interval').value) || 600;
    if (!target) return CL.toast('填目标：博主 sec_uid 或视频链接', 'warn');
    const mv = target.match(/(?:\/video\/|modal_id=)(\d{8,})/);
    if (mv) target = mv[1];
    try {
      const j = await CL.api('/api/watches', { method: 'POST', body: { type, target, note, interval_sec: interval } });
      CL.toast(j.data.existed ? '已存在，已重新启用' : `已添加监控 #${j.data.id}`, 'ok');
      document.querySelector('#w-target').value = '';
      document.querySelector('#w-note').value = '';
      await CL.loadWatches();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async checkWatch(id) {
    CL.status(`检查中 #${id}…`);
    try {
      const j = await CL.api(`/api/watches/${id}/check`, { method: 'POST' });
      CL.toast(j.data.added ? `发现 ${j.data.added} 条新数据` : '没有新数据', j.data.added ? 'ok' : 'info', 5000);
      CL.status(`#${id} 检查完成，新增 ${j.data.added}`);
      await CL.loadWatches();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  async delWatch(id) {
    try {
      await CL.api(`/api/watches/${id}`, { method: 'DELETE' });
      await CL.loadWatches();
    } catch (e) { CL.toast(e.message, 'error'); }
  },

  showQr() {
    window.open('/api/screen', '_blank');
  },

  async boot() {
    document.querySelectorAll('.menubar [data-mod]').forEach((b) => {
      b.addEventListener('click', () => CL.setMod(b.dataset.mod));
    });
    const liveBox = document.querySelector('#f-live');
    if (liveBox) {
      liveBox.addEventListener('change', (e) => {
        if (e.target.checked) CL.liveTimer = setInterval(CL.load, 15000);
        else clearInterval(CL.liveTimer);
      });
    }
    // 先加载数据：/api/screen 会启动浏览器，单线程下会拖住后面的请求
    await CL.load();
    setTimeout(() => CL.startScreen(true), 300);
    // 默认停在抖音首页（原版就是这个状态）
    try {
      const j = await CL.api('/api/screen');
      if (j.data?.url && !/^https:\/\/www\.douyin\.com\/?$/.test(j.data.url)) {
        await CL.api('/api/navigate', { method: 'POST', body: { url: 'https://www.douyin.com' } });
        document.querySelector('#url').value = 'https://www.douyin.com';
        setTimeout(() => CL.startScreen(false), 2000);
      }
    } catch (e) { /* 忽略 */ }
    try {
      const s = await CL.api('/api/stats');
      const parts = [`作品 ${s.data.items}`, `评论 ${s.data.comments}`, `用户 ${s.data.users}`];
      document.querySelector('#st-acct').textContent = parts.join('　');
    } catch (e) { /* 忽略 */ }
  },
};

function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\\.0$/, '') + '亿';
  if (v >= 10000) return (v / 10000).toFixed(1).replace(/\\.0$/, '') + '万';
  return String(v);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

CL.boot();
