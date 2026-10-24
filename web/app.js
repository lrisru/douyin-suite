const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const App = {
  state: {
    accounts: [],
    tasks: [],
    proxies: [],
    settings: null,
    license: null,
    page: { kind: 'items', offset: 0, limit: 100, total: 0, keyword: '' },
    logs: [],
  },

  async api(path, opts = {}) {
    const r = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch { j = { ok: false, error: 'bad json' }; }
    if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  },

  toast(msg, type = 'info', ms = 3600) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toast').appendChild(el);
    setTimeout(() => el.remove(), ms);
  },

  /* ---------------- tabs ---------------- */
  initTabs() {
    $$('#tabs button').forEach((b) => {
      b.onclick = () => {
        $$('#tabs button').forEach((x) => x.classList.remove('active'));
        $$('.panel').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        $(`#panel-${b.dataset.tab}`).classList.add('active');
        if (b.dataset.tab === 'data') App.loadData(0);
        if (b.dataset.tab === 'logs') App.loadLogs();
        if (b.dataset.tab === 'schedules') App.loadSchedules();
        if (b.dataset.tab === 'live') App.loadLiveMessages();
      };
    });
  },

  /* ---------------- stats ---------------- */
  async loadStats() {
    try {
      const { data } = await App.api('/api/stats');
      $('#s-accounts').textContent = data.accounts;
      $('#s-online').textContent = data.online;
      $('#s-items').textContent = data.items;
      $('#s-users').textContent = data.users;
      $('#s-queue').textContent = data.queue + (data.running || 0);
      const lic = data.license || {};
      $('#s-license').textContent = lic.enabled ? (lic.valid ? `授权：有效 ${lic.expiry || ''}` : '授权：未激活') : '授权：未启用';
      $('#dash-status').innerHTML = `
        <div><span>数据库</span><b>正常</b></div>
        <div><span>作品记录</span><b>${data.items}</b></div>
        <div><span>用户记录</span><b>${data.users}</b></div>
        <div><span>评论记录</span><b>${data.comments}</b></div>
        <div><span>直播记录</span><b>${data.lives}</b></div>
        <div><span>排队 / 运行</span><b>${data.queue} / ${data.running || 0}</b></div>`;
    } catch (e) { /* 静默 */ }
  },

  /* ---------------- accounts ---------------- */
  async reloadAccounts() {
    const { data } = await App.api('/api/accounts');
    App.state.accounts = data;
    const tb = $('#tbl-accounts tbody');
    tb.innerHTML = data.map((a) => `
      <tr>
        <td>${a.id}</td>
        <td>${esc(a.name)}<div class="sub">${esc(a.note || '')}</div></td>
        <td>${statusBadge(a.status)}</td>
        <td>${a.logged_in ? '<span class="ok">已登录</span>' : '<span class="bad">未登录</span>'}</td>
        <td>${esc(a.nickname || '-')}</td>
        <td>${a.cdp_port}</td>
        <td class="ops">
          <button onclick="App.accAction(${a.id},'login')">打开登录</button>
          <button onclick="App.accAction(${a.id},'check')">检查登录</button>
          <button onclick="App.accProxy(${a.id})" title="${esc(a.proxy || '未设置代理')}">代理</button>
          <button onclick="App.accFingerprint(${a.id})">指纹</button>
          <button onclick="App.accAction(${a.id},'stop')">关闭</button>
          <button class="danger" onclick="App.delAccount(${a.id})">删除</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="7" class="empty">还没有账号，先在上面新增一个</td></tr>`;

    const opts = data.map((a) => `<option value="${a.id}">#${a.id} ${esc(a.name)}${a.logged_in ? '（在线）' : ''}</option>`).join('');
    for (const sel of ['#kw-acc', '#u-acc', '#c-acc', '#l-acc', '#a-acc', '#m-acc', '#cookie-acc', '#rel-acc', '#conv-acc', '#dl-acc', '#live-acc', '#lv-acc']) {
      const el = $(sel);
      if (!el) continue;
      const keep = el.value;
      el.innerHTML = opts || '<option value="">无账号</option>';
      const online = data.find((a) => a.logged_in === 1);
      el.value = keep || (online ? String(online.id) : (data[0] ? String(data[0].id) : ''));
    }
  },

  async addAccount() {
    const name = $('#acc-name').value.trim();
    if (!name) return App.toast('先填账号名称', 'warn');
    try {
      await App.api('/api/accounts', { method: 'POST', body: { name, note: $('#acc-note').value.trim() } });
      $('#acc-name').value = ''; $('#acc-note').value = '';
      App.toast('账号已创建', 'ok');
      await App.reloadAccounts();
      await App.loadStats();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async accAction(id, action) {
    try {
      const r = await App.api(`/api/accounts/${id}/${action}`, { method: 'POST' });
      if (action === 'check') {
        App.toast(r.data.loggedIn ? `已登录${r.data.nickname ? '：' + r.data.nickname : ''}` : '未检测到登录态', r.data.loggedIn ? 'ok' : 'warn');
        await App.reloadAccounts();
      } else if (action === 'login') {
        App.toast('已打开浏览器，请在窗口里扫码登录', 'ok');
      } else {
        App.toast('已执行', 'ok');
        await App.reloadAccounts();
      }
      await App.loadStats();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async delAccount(id) {
    if (!confirm('删除账号记录？（浏览器配置目录会保留）')) return;
    try {
      await App.api(`/api/accounts/${id}`, { method: 'DELETE' });
      await App.reloadAccounts(); await App.loadStats();
      App.toast('已删除', 'ok');
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async importCookie() {
    const accId = $('#cookie-acc').value;
    const cookie = $('#cookie-text').value.trim();
    if (!accId) return App.toast('先选账号', 'warn');
    if (!cookie) return App.toast('先粘贴 Cookie', 'warn');
    try {
      const r = await App.api(`/api/accounts/${accId}/cookie`, { method: 'POST', body: { cookie } });
      App.toast(`写入 ${r.data.set} 条 Cookie，登录态：${r.data.loggedIn ? '已登录' : '未确认'}`, r.data.loggedIn ? 'ok' : 'warn');
      await App.reloadAccounts();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async checkAllAccounts() {
    for (const a of App.state.accounts) {
      try { await App.api(`/api/accounts/${a.id}/check`, { method: 'POST' }); } catch { /* ignore */ }
    }
    await App.reloadAccounts(); await App.loadStats();
    App.toast('检查完成', 'ok');
  },

  async accProxy(id) {
    const cur = App.state.accounts.find((a) => a.id === id)?.proxy || '';
    const v = prompt('设置代理（http://user:pass@host:port 或 host:port，留空清除）', cur);
    if (v === null) return;
    try {
      await App.api(`/api/accounts/${id}/proxy`, { method: 'POST', body: { proxy: v.trim() } });
      await App.reloadAccounts();
      App.toast(v.trim() ? '代理已设置，下次启动浏览器生效' : '已清除代理', 'ok');
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async accFingerprint(id) {
    try {
      const { data } = await App.api(`/api/accounts/${id}/fingerprint`, { method: 'POST' });
      App.toast(`UA ${data.ua.match(/Chrome\/[\d.]+/)?.[0] || ''} · ${data.timezone} · ${data.width}x${data.height}`, 'ok');
      alert(JSON.stringify(data, null, 2));
    } catch (e) { App.toast(e.message, 'error'); }
  },

  /* ---------------- tasks ---------------- */
  async reloadTasks() {
    const { data } = await App.api('/api/tasks?limit=80');
    App.state.tasks = data;
    const rows = data.map((t) => `
      <tr>
        <td>${t.id}</td><td>${esc(t.type)}</td><td>${taskBadge(t.status)}</td>
        <td>${t.done}</td><td>${t.failed}</td>
        <td>
          <button onclick="App.retryTask(${t.id})">重跑</button>
          ${t.status === 'running' || t.status === 'pending' ? `<button class="danger" onclick="App.cancelTask(${t.id})">取消</button>` : ''}
        </td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty">暂无任务</td></tr>`;
    $('#tbl-tasks tbody').innerHTML = rows;
    $('#dash-tasks tbody').innerHTML = data.slice(0, 8).map((t) => `
      <tr><td>${t.id}</td><td>${esc(t.type)}</td><td>${taskBadge(t.status)}</td>
      <td>${t.done}</td><td>${t.failed}</td><td>${fmt(t.created_at)}</td></tr>`).join('')
      || `<tr><td colspan="6" class="empty">暂无任务</td></tr>`;
  },

  async retryTask(id) {
    try { await App.api(`/api/tasks/${id}/run`, { method: 'POST' }); App.toast('已重新入队', 'ok'); await App.reloadTasks(); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  async cancelTask(id) {
    try {
      const { data } = await App.api(`/api/tasks/${id}/cancel`, { method: 'POST' });
      App.toast(data.removed ? '已取消排队任务' : '已请求取消，当前条目结束后退出', 'ok');
      await App.reloadTasks();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async createTask(type, params) {
    const accId = params.__acc || null;
    delete params.__acc;
    try {
      await App.api('/api/tasks', { method: 'POST', body: { type, params, account_id: accId } });
      App.toast('任务已入队，去「日志」看进度', 'ok');
      await App.reloadTasks(); await App.loadStats();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  accSel(sel) {
    const v = $(sel)?.value;
    return v ? Number(v) : null;
  },

  runSearch() {
    const keyword = $('#kw').value.trim();
    if (!keyword) return App.toast('先填关键词', 'warn');
    App.createTask($('#kw-type').value === 'user' ? 'search_user' : 'search_video', {
      keyword, limit: Number($('#kw-limit').value) || 50, __acc: App.accSel('#kw-acc'),
    });
  },

  runUserWorks() {
    const secUid = $('#u-secuid').value.trim();
    if (!secUid) return App.toast('先填 sec_uid', 'warn');
    App.createTask('user_works', { sec_uid: secUid, limit: Number($('#u-limit').value) || 50, __acc: App.accSel('#u-acc') });
  },

  runUserProfile() {
    const secUid = $('#u-secuid').value.trim();
    if (!secUid) return App.toast('先填 sec_uid', 'warn');
    App.createTask('user_profile', { sec_uid: secUid, __acc: App.accSel('#u-acc') });
  },

  runComments() {
    const ids = $('#c-aweme').value.split(/[\s,，]+/).filter(Boolean);
    if (!ids.length) return App.toast('先填作品 ID', 'warn');
    App.createTask('comments', { aweme_ids: ids, limit: Number($('#c-limit').value) || 100, __acc: App.accSel('#c-acc') });
  },

  runLive() {
    const rid = $('#l-rid').value.trim();
    if (!rid) return App.toast('先填直播间号', 'warn');
    App.createTask('live', { web_rid: rid, __acc: App.accSel('#l-acc') });
  },

  runRelation() {
    const secUid = $('#rel-secuid').value.trim();
    if (!secUid) return App.toast('先填 sec_uid', 'warn');
    App.createTask($('#rel-kind').value, {
      sec_uid: secUid, limit: Number($('#rel-limit').value) || 200, __acc: App.accSel('#rel-acc'),
    });
  },

  runConversations() {
    App.createTask('conversations', { limit: Number($('#conv-limit').value) || 50, __acc: App.accSel('#conv-acc') });
  },

  runDownload() {
    const urls = $('#dl-urls').value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return App.toast('先粘贴链接', 'warn');
    App.createTask('download', { urls, __acc: App.accSel('#dl-acc') });
  },

  runLiveSearch() {
    const keyword = $('#live-kw').value.trim();
    if (!keyword) return App.toast('先填关键词', 'warn');
    App.createTask('search_live', { keyword, limit: Number($('#live-limit').value) || 50, __acc: App.accSel('#live-acc') });
  },

  /* ---------------- live ---------------- */
  async startLive() {
    const web_rid = $('#lv-rid').value.trim();
    if (!web_rid) return App.toast('先填直播间号', 'warn');
    try {
      const { data } = await App.api('/api/live/start', { method: 'POST', body: { web_rid, account_id: App.accSel('#lv-acc') } });
      App.toast(`开始监听 ${data.web_rid}`, 'ok');
      App.state.liveRid = web_rid;
      await App.loadLiveMessages();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async stopLive() {
    const web_rid = App.state.liveRid || $('#lv-rid').value.trim();
    if (!web_rid) return;
    try { await App.api('/api/live/stop', { method: 'POST', body: { web_rid } }); App.toast('已停止', 'ok'); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  clearLiveView() { $('#live-view').innerHTML = ''; App.state.liveMsgs = []; },

  pushLive(m) {
    if (App.state.liveRid && String(m.web_rid) !== String(App.state.liveRid)) return;
    (App.state.liveMsgs ||= []).push(m);
    if (App.state.liveMsgs.length > 800) App.state.liveMsgs.shift();
    const filter = $('#lv-filter').value;
    if (filter && filter !== m.type) return;
    const box = $('#live-view');
    const line = document.createElement('div');
    line.className = 'line ' + m.type;
    line.textContent = `[${fmt(m.ts)}] ${m.type === 'chat' ? '💬' : m.type === 'gift' ? '🎁' : m.type === 'member' ? '👋' : '·'} ${m.user_name || ''} ${m.content || ''}`;
    box.appendChild(line);
    while (box.childElementCount > 500) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
    App.updateLiveStats();
  },

  filterLive() {
    const box = $('#live-view');
    box.innerHTML = '';
    const filter = $('#lv-filter').value;
    for (const m of App.state.liveMsgs || []) {
      if (filter && filter !== m.type) continue;
      App.pushLiveRender(m);
    }
  },

  pushLiveRender(m) {
    const box = $('#live-view');
    const line = document.createElement('div');
    line.className = 'line ' + m.type;
    line.textContent = `[${fmt(m.ts)}] ${m.type === 'chat' ? '💬' : m.type === 'gift' ? '🎁' : m.type === 'member' ? '👋' : '·'} ${m.user_name || ''} ${m.content || ''}`;
    box.appendChild(line);
  },

  updateLiveStats() {
    const list = App.state.liveMsgs || [];
    const c = (t) => list.filter((x) => x.type === t).length;
    const onlineMsg = [...list].reverse().find((x) => x.type === 'online' && x.extra?.online);
    const online = onlineMsg ? ` · 在线 ${onlineMsg.extra.online}` : '';
    $('#lv-stats').textContent = `收到 ${list.length} 条 · 弹幕 ${c('chat')} · 礼物 ${c('gift')} · 进场 ${c('member')} · 点赞 ${c('like')}${online}`;
  },

  async loadLiveMessages(webRid) {
    const rid = webRid || App.state.liveRid || $('#lv-rid').value.trim();
    if (!rid) return;
    try {
      const { data } = await App.api(`/api/live/messages?web_rid=${encodeURIComponent(rid)}&limit=100`);
      $('#tbl-live tbody').innerHTML = data.map((m) => `<tr>
        <td>${fmt(m.ts)}</td><td>${esc(m.type)}</td><td>${esc(m.user_name)}</td><td>${esc(m.content)}</td>
      </tr>`).join('') || `<tr><td colspan="4" class="empty">还没有消息</td></tr>`;
    } catch { /* ignore */ }
  },

  /* ---------------- schedules ---------------- */
  async loadSchedules() {
    try {
      const { data } = await App.api('/api/schedules');
      App.state.schedules = data;
      $('#tbl-schedules tbody').innerHTML = data.map((s) => `
        <tr>
          <td>${s.id}</td><td>${esc(s.name)}<div class="sub">${esc(s.type)}</div></td>
          <td>${esc(s.type)}</td>
          <td>${s.interval_min} 分</td>
          <td>${s.enabled ? '<span class="ok">启用</span>' : '<span class="bad">停用</span>'}</td>
          <td>${s.last_run ? fmt(s.last_run) : '-'}</td>
          <td>${s.next_run ? fmt(s.next_run) : '-'}</td>
          <td class="ops">
            <button onclick="App.runScheduleNow(${s.id})">立即跑</button>
            <button onclick="App.toggleSchedule(${s.id},${s.enabled ? 0 : 1})">${s.enabled ? '停用' : '启用'}</button>
            <button class="danger" onclick="App.delSchedule(${s.id})">删除</button>
          </td>
        </tr>`).join('') || `<tr><td colspan="8" class="empty">还没有定时任务</td></tr>`;
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async addSchedule() {
    const type = $('#sc-type').value;
    let params = {};
    const raw = $('#sc-params').value.trim();
    if (raw) {
      try { params = JSON.parse(raw); } catch { return App.toast('参数 JSON 格式不对', 'error'); }
    }
    const ids = $('#sc-accounts').value.split(/[,\s]+/).map(Number).filter(Boolean);
    try {
      await App.api('/api/schedules', {
        method: 'POST',
        body: { name: $('#sc-name').value.trim() || type, type, params, account_ids: ids, interval_min: Number($('#sc-interval').value) || 60 },
      });
      $('#sc-name').value = ''; $('#sc-params').value = '';
      App.toast('已创建', 'ok');
      await App.loadSchedules();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async toggleSchedule(id, enabled) {
    try { await App.api(`/api/schedules/${id}`, { method: 'POST', body: { enabled: !!enabled } }); await App.loadSchedules(); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  async runScheduleNow(id) {
    try {
      const { data } = await App.api(`/api/schedules/${id}`, { method: 'POST', body: { run_now: true } });
      App.toast('已触发任务 #' + data.triggered, 'ok');
      await App.loadSchedules(); await App.reloadTasks();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async delSchedule(id) {
    if (!confirm('删除这个定时任务？')) return;
    try { await App.api(`/api/schedules/${id}`, { method: 'DELETE' }); await App.loadSchedules(); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  async parseShare() {
    const url = $('#parse-url').value.trim();
    if (!url) return App.toast('先粘贴链接', 'warn');
    $('#parse-out').textContent = '解析中…';
    $('#parse-dl').style.display = 'none';
    try {
      const { data } = await App.api('/api/parse', { method: 'POST', body: { url } });
      $('#parse-out').textContent = JSON.stringify(data, null, 2);
      if (data.ok && (data.video || data.images?.length || data.aweme_id)) {
        App.state.parsed = data;
        $('#parse-dl').style.display = '';
        $('#parse-dl').textContent = data.images?.length ? `下载这个图集（${data.images.length} 张）` : '下载这个视频';
      } else {
        App.toast(data.reason || '解析没拿到地址', 'warn');
      }
    } catch (e) {
      $('#parse-out').textContent = '失败：' + e.message;
    }
  },

  async downloadParsed() {
    const p = App.state.parsed;
    if (!p?.aweme_id) return App.toast('先解析一个作品', 'warn');
    try {
      const r = await App.api('/api/download', { method: 'POST', body: { aweme_ids: [p.aweme_id] } });
      App.toast(`已加入下载队列（任务 #${r.data.task_id}），完成后点「打开下载文件夹」`, 'ok');
      await App.reloadTasks();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async openDownloads() {
    try {
      const { data } = await App.api('/api/open-downloads', { method: 'POST' });
      App.toast('已打开：' + data, 'ok');
    } catch (e) { App.toast(e.message, 'error'); }
  },

  runAction() {
    const type = $('#a-type').value;
    const ids = $('#a-ids').value.split(/[\s,，]+/).filter(Boolean);
    if (!ids.length) return App.toast('先填 ID 列表', 'warn');
    const params = { __acc: App.accSel('#a-acc') };
    if (type === 'follow') params.sec_uids = ids; else params.aweme_ids = ids;
    App.createTask(type, params);
  },

  runMessage() {
    const type = $('#m-type').value;
    const ids = $('#m-ids').value.split(/[\s,，]+/).filter(Boolean);
    const text = $('#m-text').value.trim();
    if (!ids.length) return App.toast('先填 ID 列表', 'warn');
    if (!text) return App.toast('先填话术', 'warn');

    // 类型和 ID 格式要对上，否则会打开不存在的页面
    const isSecUid = (x) => /^MS4wLjAB[\w-]{6,}/.test(x);
    const isAwemeId = (x) => /^\d{8,}$/.test(x);
    if (type === 'comment' && ids.every(isSecUid)) {
      return App.toast('评论要填「作品 ID」（纯数字）。你要私信的话，把上面类型改成「私信」', 'error', 6000);
    }
    if (type === 'comment' && !ids.every(isAwemeId)) {
      return App.toast('评论要填作品 ID（纯数字），当前有格式不对的条目', 'error', 5000);
    }
    if (type === 'dm' && !ids.every(isSecUid)) {
      return App.toast('私信要填用户 sec_uid（MS4wLjAB 开头）。作品 ID 是拿来评论的', 'error', 6000);
    }

    const texts = text.split('|').map((s) => s.trim()).filter(Boolean);
    const params = { __acc: App.accSel('#m-acc'), texts };
    if (type === 'dm') params.sec_uids = ids; else params.aweme_ids = ids;
    App.createTask(type, params);
  },

  /* ---------------- data ---------------- */
  async loadData(offset) {
    const kind = $('#d-kind').value;
    const keyword = $('#d-kw').value.trim();
    const taskId = Number($('#d-task').value || 0);
    const fromDate = $('#d-from').value;
    const toDate = $('#d-to').value;
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : 0;
    const to = toDate ? new Date(`${toDate}T23:59:59`).getTime() : 0;
    const st = App.state.page;
    if (offset === 0) st.offset = 0;
    st.kind = kind; st.keyword = keyword; st.limit = 100; st.task_id = taskId; st.from = from; st.to = to;
    try {
      const q = new URLSearchParams({ limit: st.limit, offset: st.offset, keyword });
      if (taskId) q.set('task_id', taskId);
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const j = await App.api(`/api/data/${kind}?${q}`);
      st.total = j.total;
      const cols = j.columns || [];
      // 评论表多带一列 sec_uid 用于一键私信，表格里不必全展示
      const keys = cols.map((c) => c.key)
        .filter((k) => !['raw', 'user_sec_uid'].includes(k))
        .slice(0, 7);
      const labelMap = Object.fromEntries(cols.map((c) => [c.key, c.label]));
      const selectable = kind === 'comments';
      $('#tbl-data thead').innerHTML = `<tr>${selectable ? '<th style="width:28px"><input type="checkbox" id="d-all" onchange="App.toggleAllSel(this)"></th>' : ''}${keys.map((k) => `<th>${esc(labelMap[k] || k)}</th>`).join('')}</tr>`;
      $('#tbl-data tbody').innerHTML = j.data.map((row) => `
        <tr>${selectable ? `<td><input type="checkbox" class="d-sel" data-sec="${esc(row.user_sec_uid || '')}" data-name="${esc(row.user_name || '')}"></td>` : ''}${keys.map((k) => `<td title="${esc(row[k] ?? '')}">${cell(k, row[k])}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${keys.length + (selectable ? 1 : 0)}" class="empty">没有数据</td></tr>`;
      $('#d-count').textContent = j.total
        ? `共 ${j.total} 条，第 ${st.offset + 1}-${Math.min(st.offset + st.limit, j.total)} 条`
        : '共 0 条';
    } catch (e) { App.toast(e.message, 'error'); }
  },

  pageData(delta) {
    const st = App.state.page;
    const next = st.offset + delta * st.limit;
    if (next < 0) return;
    if (next >= st.total) return;
    st.offset = next;
    App.loadData(st.offset);
  },

  toggleAllSel(el) {
    document.querySelectorAll('.d-sel').forEach((b) => { b.checked = el.checked; });
  },

  selectedSecUids() {
    const seen = new Set();
    const out = [];
    for (const b of document.querySelectorAll('.d-sel:checked')) {
      const sec = b.dataset.sec;
      if (sec && !seen.has(sec)) { seen.add(sec); out.push({ sec, name: b.dataset.name || '' }); }
    }
    return out;
  },

  async enrichComments() {
    if ($('#d-kind').value !== 'comments') return App.toast('先切到「评论」数据源', 'warn');
    const n = prompt('补全多少个评论者的资料？（性别/城市/简介/粉丝，约 0.8 秒一个）', '50');
    if (n === null) return;
    App.toast('补全中，请稍候…', 'info', 8000);
    try {
      const { data } = await App.api('/api/enrich', { method: 'POST', body: { limit: Number(n) || 50 } });
      App.toast(`补全完成：成功 ${data.ok}，失败 ${data.fail}`, 'ok', 6000);
      await App.loadData(App.state.page.offset);
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async dmSelected() {
    const picked = App.selectedSecUids();
    if (!picked.length) {
      return App.toast('先在上表勾选要私信的人（只有「评论」数据源带勾选框）', 'warn', 5000);
    }
    const accounts = App.state.accounts.filter((a) => a.logged_in === 1);
    if (!accounts.length) return App.toast('没有在线账号', 'warn');

    const def = '看到您在问贴膜，什么车型？我按车型给您报个实在价|您是在哪个城市？方便说下什么车，我看看能不能上门|看到您问隐形车衣，是新车还是开了一段时间了？';
    const text = prompt(`将向 ${picked.length} 人发私信。\n话术（多条用 | 分隔，随机取一条）：`, def);
    if (text === null) return;
    const texts = text.split('|').map((s) => s.trim()).filter(Boolean);
    if (!texts.length) return App.toast('话术不能为空', 'warn');

    try {
      const r = await App.api('/api/tasks', {
        method: 'POST',
        body: {
          type: 'dm',
          params: { sec_uids: picked.map((x) => x.sec), texts },
          account_id: accounts[0].id,
        },
      });
      App.toast(`已建私信任务 #${r.data.id}，共 ${picked.length} 人。去「日志」看进度`, 'ok', 6000);
      await App.reloadTasks();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async copySelected() {
    const picked = App.selectedSecUids();
    if (!picked.length) return App.toast('先勾选', 'warn');
    const list = picked.map((x) => x.sec).join('\n');
    try {
      await navigator.clipboard.writeText(list);
      App.toast(`已复制 ${picked.length} 个 sec_uid`, 'ok');
    } catch {
      prompt('复制下面的内容：', list);
    }
  },

  exportData(format) {
    const kind = $('#d-kind').value;
    const keyword = $('#d-kw').value.trim();
    const taskId = Number($('#d-task').value || 0);
    const fromDate = $('#d-from').value;
    const toDate = $('#d-to').value;
    const q = new URLSearchParams({ kind, format, keyword });
    if (taskId) q.set('task_id', taskId);
    if (fromDate) q.set('from', String(new Date(`${fromDate}T00:00:00`).getTime()));
    if (toDate) q.set('to', String(new Date(`${toDate}T23:59:59`).getTime()));
    window.open(`/api/export?${q}`, '_blank');
    App.toast(`正在导出 ${format === 'csv' ? 'CSV' : 'Excel'}`, 'ok');
  },

  /* ---------------- proxies ---------------- */
  async reloadProxies() {
    const { data } = await App.api('/api/proxies');
    App.state.proxies = data;
    $('#tbl-proxy tbody').innerHTML = data.map((p) => `
      <tr>
        <td>${p.id}</td><td>${esc(p.url)}</td>
        <td>${p.status === 'ok' ? '<span class="ok">可用</span>' : p.status === 'bad' ? '<span class="bad">失败</span>' : '未测'}</td>
        <td>${p.latency || ''}</td><td>${esc(p.exit_ip || '')}</td>
        <td class="ops">
          <button onclick="App.checkProxy(${p.id})">检测</button>
          <button class="danger" onclick="App.delProxy(${p.id})">删除</button>
        </td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty">还没有代理</td></tr>`;
  },

  async addProxy() {
    const url = $('#proxy-input').value.trim();
    if (!url) return App.toast('先填代理地址', 'warn');
    try {
      await App.api('/api/proxies', { method: 'POST', body: { url } });
      $('#proxy-input').value = '';
      await App.reloadProxies();
      App.toast('已添加', 'ok');
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async checkProxy(id) {
    App.toast('检测中…');
    try {
      const { data } = await App.api(`/api/proxies/${id}/check`, { method: 'POST' });
      App.toast(data.ok ? `可用 ${data.latency}ms ${data.exitIp || ''}` : `不可用：${data.error || ''}`, data.ok ? 'ok' : 'warn');
      await App.reloadProxies();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async checkAllProxy() {
    App.toast('批量检测中，请稍候…');
    try { await App.api('/api/proxies/check-all', { method: 'POST' }); await App.reloadProxies(); App.toast('检测完成', 'ok'); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  async checkMyIp() {
    const el = document.querySelector('#my-ip');
    if (el) el.textContent = '查询中…';
    try {
      const { data } = await App.api('/api/ip');
      if (!data.ok) { if (el) el.textContent = '查询失败'; return App.toast('所有 IP 源都没响应', 'error'); }
      const warn = data.consistent ? '' : '（多源结果不一致，可能走了分流代理）';
      const text = `当前出口 IP：${data.ip}　归属：${data.location || '未知'}　${warn}`;
      if (el) el.textContent = text;
      App.toast(text, data.consistent ? 'ok' : 'warn');
    } catch (e) {
      if (el) el.textContent = '查询失败：' + e.message;
      App.toast(e.message, 'error');
    }
  },

  async delProxy(id) {
    try { await App.api(`/api/proxies/${id}`, { method: 'DELETE' }); await App.reloadProxies(); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  /* ---------------- settings ---------------- */
  async loadSettings() {
    const { data } = await App.api('/api/settings');
    App.state.settings = data;
    $('#s-conc').value = data.task.concurrency;
    $('#s-delay1').value = data.task.minDelayMs;
    $('#s-delay2').value = data.task.maxDelayMs;
    $('#s-scroll').value = data.task.scrollTimes;
    $('#s-headless').checked = !!data.headless;
    $('#s-chrome').value = data.chrome || '';
    $('#s-feishu').value = data.notify?.feishu || '';
    $('#s-dingtalk').value = data.notify?.dingtalk || '';
    $('#s-wechat').value = data.notify?.wechat || '';
    App.renderLicense();
  },

  async saveSettings() {
    const body = {
      headless: $('#s-headless').checked,
      chrome: $('#s-chrome').value.trim(),
      task: {
        concurrency: Math.max(1, Number($('#s-conc').value) || 1),
        minDelayMs: Math.max(300, Number($('#s-delay1').value) || 1500),
        maxDelayMs: Math.max(500, Number($('#s-delay2').value) || 4000),
        scrollTimes: Math.max(1, Number($('#s-scroll').value) || 6),
      },
      notify: {
        feishu: $('#s-feishu').value.trim(),
        dingtalk: $('#s-dingtalk').value.trim(),
        wechat: $('#s-wechat').value.trim(),
      },
    };
    try { await App.api('/api/settings', { method: 'POST', body }); App.toast('已保存', 'ok'); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  async testNotify() {
    try {
      const r = await App.api('/api/notify/test', { method: 'POST' });
      const okCount = (r.data || []).filter((x) => x.status === 'fulfilled').length;
      App.toast(okCount ? `已发送（${okCount} 个渠道）` : '没有可用的 webhook，先去填地址', okCount ? 'ok' : 'warn');
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async renderLicense() {
    try {
      const { data } = await App.api('/api/license');
      App.state.license = data;
      $('#lic-box').innerHTML = `
        <div><span>机器码</span><b>${esc(data.machine)}</b></div>
        <div><span>校验</span><b>${data.enabled ? (data.valid ? '已启用·有效' : '已启用·未激活') : '未启用'}</b></div>
        <div><span>到期</span><b>${esc(data.expiry || '-')}</b></div>`;
    } catch { /* ignore */ }
  },

  async activate() {
    const key = $('#lic-key').value.trim();
    if (!key) return App.toast('先填卡密', 'warn');
    try {
      const { data } = await App.api('/api/license/activate', { method: 'POST', body: { key } });
      App.toast('激活成功，到期 ' + data.expiry, 'ok');
      await App.renderLicense();
    } catch (e) { App.toast(e.message, 'error'); }
  },

  async openDataDir() {
    try { const { data } = await App.api('/api/open-data-dir', { method: 'POST' }); App.toast('已打开：' + data, 'ok'); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  /* ---------------- logs ---------------- */
  initSSE() {
    const es = new EventSource('/api/events');
    es.onopen = () => $('#live-dot').classList.add('on');
    es.onerror = () => $('#live-dot').classList.remove('on');
    es.addEventListener('log', (ev) => {
      const item = JSON.parse(ev.data);
      App.pushLog(item);
    });
    es.addEventListener('task', () => {
      App.reloadTasks(); App.loadStats();
    });
    es.addEventListener('live-message', (ev) => {
      try { App.pushLive(JSON.parse(ev.data)); } catch { /* ignore */ }
    });
  },

  pushLog(item) {
    App.state.logs.push(item);
    if (App.state.logs.length > 1500) App.state.logs.shift();
    const filter = $('#log-level')?.value || '';
    if (!filter || filter === item.level) {
      const view = $('#log-view');
      const line = document.createElement('div');
      line.className = 'line ' + item.level;
      line.textContent = `[${fmt(item.ts)}] [${item.level}] [${item.scope}] ${item.msg}`;
      view.appendChild(line);
      while (view.childElementCount > 1200) view.removeChild(view.firstChild);
      view.scrollTop = view.scrollHeight;
    }
    $('#log-count').textContent = `${App.state.logs.length} 条`;
  },

  filterLogs() {
    const filter = $('#log-level').value;
    const view = $('#log-view');
    view.innerHTML = '';
    for (const item of App.state.logs) {
      if (filter && filter !== item.level) continue;
      const line = document.createElement('div');
      line.className = 'line ' + item.level;
      line.textContent = `[${fmt(item.ts)}] [${item.level}] [${item.scope}] ${item.msg}`;
      view.appendChild(line);
    }
    view.scrollTop = view.scrollHeight;
  },

  clearLogView() { $('#log-view').innerHTML = ''; },

  async loadLogs() {
    try {
      const { data } = await App.api('/api/logs?limit=300');
      App.state.logs = data.reverse();
      App.filterLogs();
    } catch { /* ignore */ }
  },

  /* ---------------- boot ---------------- */
  async reloadAll() {
    await Promise.allSettled([App.loadStats(), App.reloadAccounts(), App.reloadTasks(), App.reloadProxies(), App.loadSettings(), App.renderLicense(), App.loadSchedules()]);
    if ($('#panel-data').classList.contains('active')) await App.loadData(0);
  },

  async boot() {
    App.initTabs();
    // 评论/私信类型切换时，提示对应的 ID 格式
    const typeSel = $('#m-type');
    if (typeSel) {
      const sync = () => {
        const isDm = typeSel.value === 'dm';
        const box = $('#m-ids');
        if (!box) return;
        box.placeholder = isDm
          ? '用户 sec_uid（MS4wLjAB 开头），每行一个'
          : '作品 ID（纯数字），每行一个';
      };
      typeSel.addEventListener('change', sync);
      sync();
    }
    await App.reloadAll();
    App.initSSE();
    setInterval(() => App.loadStats(), 8000);
    setInterval(() => { if ($('#panel-data').classList.contains('active')) App.loadData(App.state.page.offset); }, 15000);
  },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function statusBadge(s) {
  const map = { running: '启动中', online: '在线', offline: '离线', error: '异常' };
  return `<span class="badge ${s}">${map[s] || s}</span>`;
}
function taskBadge(s) {
  const map = { pending: '排队', running: '运行中', done: '完成', failed: '失败', cancelled: '已取消' };
  return `<span class="badge ${s}">${map[s] || s}</span>`;
}
function cell(key, v) {
  if (v == null || v === '') return '';
  if (key === 'url') return `<a href="${esc(v)}" target="_blank" rel="noreferrer">打开</a>`;
  if (key === 'collected_at' || key === 'create_time') return fmt(key === 'create_time' && v < 1e12 ? v * 1000 : v);
  return esc(String(v).slice(0, 60));
}

window.App = App;
App.boot();
