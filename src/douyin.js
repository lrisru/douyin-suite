import { ResponseCollector } from './cdp.js';
import { sleep, randInt, logger } from './util.js';

export const SEL = {
  searchInput: ['input[data-e2e="searchbar-input"]', '#douyin-header input[type="text"]'],
  searchBtn: ['button[data-e2e="searchbar-button"]', '#douyin-header button[type="submit"]'],
  digg: [
    'div[data-e2e="video-player-digg"]',
    'div[data-e2e="feed-active-video"] div[data-e2e="video-player-digg"]',
    '[data-e2e="video-player-digg"]',
  ],
  collect: [
    'div[data-e2e="video-player-collect"]',
    'div[data-e2e="feed-active-video"] div[data-e2e="video-player-collect"]',
    '[data-e2e="video-player-collect"]',
  ],
  followBtn: [
    'button[data-e2e="user-info-follow-btn"]',
    'div[data-e2e="user-info"] button',
    'div[data-e2e="user-info"] [role="button"]',
  ],
  commentIcon: [
    'div[data-e2e="feed-comment-icon"]',
    'div[data-e2e="feed-active-video"] div[data-e2e="feed-comment-icon"]',
  ],
  commentInput: [
    'div.comment-input-container div.comment-input-inner-container',
    'div.comment-input-inner-container',
    '#merge-all-comment-container div[contenteditable="true"]',
  ],
  commentEditor: [
    'div.comment-input-inner-container [contenteditable="true"]',
    'div.public-DraftEditor-content',
    '#merge-all-comment-container div[contenteditable="true"]',
  ],
  commentSend: [
    'div.comment-input-container button',
    'div.comment-input-inner-container button',
  ],
  dmEntry: [
    'button[data-e2e="user-info-dm-btn"]',
    '[data-e2e="user-info-dm-btn"]',
    'div[data-e2e="user-info"] button[data-e2e*="dm"]',
  ],
  dmInput: [
    'div[class*="messageEditor"] [contenteditable]',
    '.editor-kit-container [contenteditable]',
    '[data-placeholder="发送消息"] [contenteditable]',
    'div[data-e2e="msg-input"] [contenteditable="true"]',
    '#imSaasContainerId [contenteditable="true"]',
    '[contenteditable="true"]',
  ],
  dmEditorBox: [
    'div[class*="messageEditor"]',
    '.editor-kit-container',
    '[data-placeholder="发送消息"]',
    '#imSaasContainerId',
  ],
  dmSend: ['span.e2e-send-msg-btn', 'svg.e2e-send-msg-btn', 'button.e2e-send-msg-btn'],
  userPost: ['div[data-e2e="user-post-list"] ul[data-e2e="scroll-list"] li'],
  followersTab: [
    'div[data-e2e="user-tab"] span',
    '#semiTabUser a',
    'ul[role="tablist"] li',
  ],
};

const SCROLL_JS = `(() => { window.scrollBy(0, Math.round(window.innerHeight * 0.92)); return window.scrollY; })()`;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 状态位判断，兼容 is-digged / is-not-digged / video-player-no-digged / video-player-is-digged */
function isStateOn(state, kind) {
  const t = String(state || '').toLowerCase();
  if (t.includes(`no-${kind}`) || t.includes(`no_${kind}`) || t.includes(`not-${kind}`) || t.includes(`not_${kind}`)) return false;
  return t.includes(kind);
}

export function parseAweme(a, ctx = {}) {
  if (!a) return null;
  const awemeId = a.aweme_id || a.awemeId || a.aweme_id_str;
  if (!awemeId) return null;
  const author = a.author || {};
  const st = a.statistics || {};
  return {
    aweme_id: String(awemeId),
    desc: a.desc || '',
    author: author.nickname || '',
    author_uid: author.uid || '',
    author_sec_uid: author.sec_uid || '',
    digg: num(st.digg_count),
    comment: num(st.comment_count),
    collect: num(st.collect_count),
    share: num(st.share_count),
    create_time: num(a.create_time),
    url: `https://www.douyin.com/video/${awemeId}`,
    keyword: ctx.keyword || '',
    raw: a,
  };
}

export function parseUser(u, ctx = {}) {
  if (!u) return null;
  const secUid = u.sec_uid || u.secUid;
  if (!secUid) return null;
  return {
    sec_uid: secUid,
    uid: u.uid || '',
    unique_id: u.unique_id || u.short_id || '',
    nickname: u.nickname || '',
    signature: u.signature || '',
    follower_count: num(u.follower_count),
    following_count: num(u.following_count),
    total_favorited: num(u.total_favorited),
    avatar: (u.avatar_thumb?.url_list || u.avatar_medium?.url_list || [])[0] || '',
    keyword: ctx.keyword || '',
    raw: u,
  };
}

function parseConversation(c) {
  if (!c || typeof c !== 'object') return null;
  const id = c.conversation_id || c.conversationId || c.id || c.conv_id;
  if (!id) return null;
  const peer = c.participant || c.other_user || c.user || {};
  const last = c.last_message || c.lastMessage || {};
  return {
    conversation_id: String(id),
    nickname: peer.nickname || c.nickname || '',
    sec_uid: peer.sec_uid || '',
    uid: peer.uid || '',
    unread: Number(c.unread_count || c.unreadCount || 0),
    last_message: last.content || last.text || c.last_msg || '',
    last_time: Number(last.created_at || last.createdAt || c.updated_at || 0),
    raw: c,
  };
}

export function collectFromJson(json, ctx, out) {
  if (!json || typeof json !== 'object') return;
  const push = (a) => {
    const r = parseAweme(a, ctx);
    if (r) out.items.push(r);
  };
  const pushUser = (u) => {
    const r = parseUser(u, ctx);
    if (r) out.users.push(r);
  };

  const arr = json.data || json.aweme_list || json.data_list;
  if (Array.isArray(arr)) {
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      if (it.aweme_info) push(it.aweme_info);
      else if (it.aweme_id) push(it);
      if (it.user_info) pushUser(it.user_info);
      else if (it.user_list) for (const u of it.user_list) pushUser(u);
      else if (it.sec_uid && !it.aweme_id) pushUser(it);
    }
  }
  // discover/search 的用户结果是 {user_info:{...}} 包裹的
  if (Array.isArray(json.user_list)) for (const u of json.user_list) pushUser(u?.user_info || u);
  // live/search 的结果放在 data[] 里
  if (Array.isArray(json.data) && json.data[0]?.lives) {
    for (const it of json.data) if (it.lives) out.lives.push(it.lives);
  }
  if (json.aweme_detail) push(json.aweme_detail);
  if (json.user && json.user.sec_uid) pushUser(json.user);
  if (Array.isArray(json.comments)) {
    for (const c of json.comments) {
      out.comments.push({
        cid: String(c.cid || ''),
        aweme_id: String(c.aweme_id || ctx.awemeId || ''),
        text: c.text || '',
        user_name: c.user?.nickname || '',
        user_uid: c.user?.uid || '',
        user_sec_uid: c.user?.sec_uid || '',
        digg: num(c.digg_count),
        create_time: num(c.create_time),
        raw: c,
      });
    }
  }
  if (json.room) out.lives.push(json.room);
  if (Array.isArray(json.conversation_list)) {
    for (const c of json.conversation_list) {
      const r = parseConversation(c);
      if (r) out.conversations.push(r);
    }
  }
  if (Array.isArray(json.followers)) for (const u of json.followers) pushUser(u);
  if (Array.isArray(json.following)) for (const u of json.following) pushUser(u);
}

export class DouyinService {
  constructor(host, config) {
    this.host = host;
    this.config = config;
  }

  static async randomPause(min, max) {
    await sleep(randInt(min, max));
  }

  async assertLogin(account) {
    const st = await this.host.checkLogin(account);
    if (!st.loggedIn) {
      throw new Error(`账号 #${account.id} 未登录：请在「账号」页点「打开登录」扫码后再跑任务`);
    }
    return st;
  }

  /** 页面健康检查：验证码页 / 安全验证页要给出明确提示，而不是静默 0 条 */
  async assertPageUsable(cdp) {
    let s = null;
    try {
      s = await cdp.evaluate(`(() => ({
        title: document.title || '',
        url: location.href || '',
        text: ((document.body && document.body.innerText) || '').slice(0, 200),
      }))()`);
    } catch {
      return null;
    }
    if (!s) return null;
    const blob = `${s.title}`;
    if (/验证码|安全验证|滑块验证|请完成验证/.test(blob)) {
      throw new Error('触发抖音验证码：请在该账号的浏览器窗口里手动通过验证后重试');
    }
    if (/\/(verify|captcha)/i.test(s.url)) {
      throw new Error(`被重定向到验证页（${s.url.slice(0, 60)}）：请手动通过验证后重试`);
    }
    if (!s.title && !s.text) {
      throw new Error('页面空白：可能是网络或账号状态异常，请打开该账号浏览器确认');
    }
    return s;
  }

  /** 在页面上下文里发请求：自动带 cookie，不用自己算签名 */
  async fetchInPage(cdp, url) {
    return cdp.evaluate(`(async () => {
      try {
        const res = await fetch(${JSON.stringify(url)}, {
          credentials: 'include',
          headers: { referer: location.href },
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON */ }
        return { status: res.status, json, text: json ? '' : text.slice(0, 200) };
      } catch (e) {
        return { status: 0, json: null, text: e.message };
      }
    })()`);
  }

  /**
   * 通用：打开页面 + 抓指定接口响应 + 滚动
   */
  async capturePage(account, url, patterns, { scrolls = 0, scrollDelayMs = 1200, settleMs = 2200, ctx = {}, extraClicks = [] } = {}) {
    // 先拿会话但先不导航，确保页面加载初期的请求也能被 collector 抓到
    const { cdp } = await this.host.page(account);
    const collector = new ResponseCollector(cdp, patterns);
    const out = { items: [], users: [], comments: [], lives: [], conversations: [], pages: 0, pageGone: false };
    collector.watch((entry) => {
      out.pages++;
      collectFromJson(entry.json, ctx, out);
    });

    try {
      await cdp.navigate(url, { waitMs: 600 });
      await sleep(settleMs);
      await this.assertPageUsable(cdp);
      for (const sel of extraClicks) {
        try { await cdp.clickSelector(sel); await sleep(600); } catch { /* ignore */ }
      }
      for (let i = 0; i < scrolls; i++) {
        try { await cdp.evaluate(SCROLL_JS); } catch { /* ignore */ }
        await sleep(scrollDelayMs + randInt(0, 400));
      }
      await sleep(600);
      try {
        out.pageGone = await cdp.evaluate(`/用户不存在|页面不存在|账号已注销/.test((document.body && document.body.innerText) || '')`);
      } catch { /* ignore */ }
    } finally {
      collector.stop();
    }
    return out;
  }

  async search(account, { keyword, type = 'video', scrolls = 5, limit = 200, url: overrideUrl, patterns, settleMs }) {
    await this.assertLogin(account);
    const t = type === 'user' ? 'user' : type === 'live' ? 'live' : 'video';
    const url = overrideUrl || `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=${t}`;
    logger.info('douyin', `搜索「${keyword}」type=${t}`);
    const res = await this.capturePage(account, url, patterns || [
      /aweme\/v1\/web\/(general\/search|search\/item|discover\/search|live\/search)/,
    ], { scrolls: scrolls || this.config.task.scrollTimes, scrollDelayMs: this.config.task.scrollDelayMs, settleMs, ctx: { keyword } });

    const uniq = new Map();
    if (t === 'user') {
      for (const u of res.users) uniq.set(u.sec_uid, u);
      return { users: [...uniq.values()].slice(0, limit), pages: res.pages };
    }
    if (t === 'live') {
      // live/search 返回 {type, lives:{aweme_id, author, rawdata:"{...}"}}，真实字段在 rawdata 里
      const lives = (res.lives || []).map((r) => {
        let rd = {};
        try { rd = typeof r.rawdata === 'string' ? JSON.parse(r.rawdata) : (r.rawdata || {}); } catch { rd = {}; }
        const roomId = String(rd.id_str || rd.id || r.aweme_id || '');
        return {
          web_rid: String(r.owner?.web_rid || rd.web_rid || ''), // 搜索接口不带短号，需进房间才有
          room_id: roomId,
          title: rd.title || r.title || '',
          anchor: r.author?.nickname || '',
          online: Number(rd.user_count || 0),
          url: r.author?.sec_uid ? `https://www.douyin.com/user/${r.author.sec_uid}` : '',
          raw: { aweme_id: r.aweme_id, author: r.author?.nickname, sec_uid: r.author?.sec_uid, room: rd },
        };
      }).filter((x) => x.room_id);
      return { lives, pages: res.pages };
    }
    for (const it of res.items) uniq.set(it.aweme_id, it);
    return { items: [...uniq.values()].slice(0, limit), pages: res.pages };
  }

  async userProfile(account, { secUid, keyword = '' }) {
    await this.assertLogin(account);
    const url = `https://www.douyin.com/user/${secUid}`;
    const res = await this.capturePage(account, url, [/aweme\/v1\/web\/user\/profile\/other/, /aweme\/v1\/web\/user\//], {
      scrolls: 1, settleMs: 2500, ctx: { keyword },
    });
    const uniq = new Map();
    for (const u of res.users) uniq.set(u.sec_uid, u);
    const found = [...uniq.values()][0] || null;
    if (!found) {
      throw new Error(res.pageGone
        ? `该用户不存在或已注销：${secUid}`
        : `没有取到用户资料（可能被限制或页面未加载）：${secUid}`);
    }
    return found;
  }

  async userWorks(account, { secUid, keyword = '', scrolls = 5, limit = 200 }) {
    await this.assertLogin(account);
    const url = `https://www.douyin.com/user/${secUid}`;
    const res = await this.capturePage(account, url, [/aweme\/v1\/web\/aweme\/post/, /aweme\/v1\/web\/user\//], {
      scrolls: scrolls || this.config.task.scrollTimes, ctx: { keyword },
    });
    const uniq = new Map();
    for (const it of res.items) uniq.set(it.aweme_id, it);
    const items = [...uniq.values()].slice(0, limit);
    if (!items.length && res.pageGone) {
      throw new Error(`该用户不存在或已注销：${secUid}`);
    }
    return { items, pages: res.pages };
  }

  async comments(account, { awemeId, scrolls = 8, limit = 300, url: overrideUrl, patterns }) {
    await this.assertLogin(account);
    const url = overrideUrl || `https://www.douyin.com/video/${awemeId}`;
    const { cdp } = await this.host.page(account);
    const collector = new ResponseCollector(cdp, patterns || [/aweme\/v1\/web\/comment\/list/]);
    const out = { comments: [], pages: 0 };
    collector.watch((entry) => {
      out.pages++;
      collectFromJson(entry.json, { awemeId }, out);
    });
    try {
      await cdp.navigate(url, { waitMs: 600 });
      await sleep(2800);
      // 展开评论区
      try { await cdp.clickFirst(SEL.commentIcon); } catch { /* 已展开 */ }
      await sleep(1600);
      // 评论在独立滚动容器里（不是 window），滚它才会触发加载
      for (let i = 0; i < scrolls; i++) {
        await cdp.evaluate(`(() => {
          let box = document.querySelector('div[class*="route-scroll-container"], div[class*="comment-mainContent"]');
          if (!box) {
            let best = null;
            for (const el of document.querySelectorAll('div')) {
              const st = getComputedStyle(el);
              if (!/(auto|scroll)/.test(st.overflowY)) continue;
              const over = el.scrollHeight - el.clientHeight;
              if (over > 50 && (!best || over > best.over)) best = { el, over };
            }
            box = best ? best.el : null;
          }
          if (!box) { window.scrollBy(0, window.innerHeight); return false; }
          box.scrollTop = box.scrollHeight;
          return true;
        })()`);
        await sleep(1200 + randInt(0, 400));
      }
    } finally {
      collector.stop();
    }
    const uniq = new Map();
    for (const c of out.comments) if (c.cid) uniq.set(c.cid, c);
    return { comments: [...uniq.values()].slice(0, limit), pages: out.pages };
  }

  async live(account, { webRid, keyword = '' }) {
    await this.assertLogin(account);
    const url = `https://live.douyin.com/${webRid}`;
    const res = await this.capturePage(account, url, [/webcast\/(room|user|im)/], { scrolls: 0, settleMs: 4000, ctx: { keyword } });
    const { cdp } = await this.host.page(account);
    const dom = await cdp.evaluate(`(() => {
      const pick = (sels) => { for (const s of sels) { const el = document.querySelector(s); if (el && el.innerText) return el.innerText.trim(); } return ''; };
      const count = [...document.querySelectorAll('span, div')].map(n => n.innerText || '').find(t => /^\\d+(\\.\\d+)?[万wW]?$/.test(t.trim()));
      return {
        title: pick(['[data-e2e="live-room-title"]', 'h1', '.live-room-title']),
        anchor: pick(['[data-e2e="live-room-anchor-name"]', 'a[href*="/user/"] span']),
        online: count || '',
        url: location.href,
      };
    })()`);
    const first = res.lives[0] || {};
    return {
      web_rid: webRid,
      room_id: first.id_str || first.id || '',
      title: dom?.title || first.title || '',
      anchor: dom?.anchor || first.owner?.nickname || '',
      online: Number(String(dom?.online || '').replace(/[^\d.]/g, '')) || 0,
      url: dom?.url || url,
      raw: { dom, api: first },
    };
  }

  /* --------------------------- 互动动作 --------------------------- */

  async like(account, { awemeId, url }) {
    await this.assertLogin(account);
    const target = url || `https://www.douyin.com/video/${awemeId}`;
    const { cdp } = await this.host.page(account, target);
    await sleep(2600);
    const sel = await cdp.pick(SEL.digg);
    if (!sel) throw new Error('未找到点赞按钮（选择器需更新，见 src/douyin.js 顶部 SEL）');
    const before = await cdp.evaluate(`(() => { const d = document.querySelector(${JSON.stringify(sel)}); return d ? d.getAttribute('data-e2e-state') || '' : ''; })()`);
    if (isStateOn(before, 'digg')) return { ok: true, changed: false, state: before, note: '已经是点赞状态', selector: sel };
    await cdp.clickSelector(sel);
    await sleep(1500);
    const after = await cdp.evaluate(`(() => { const d = document.querySelector(${JSON.stringify(sel)}); return d ? d.getAttribute('data-e2e-state') || '' : ''; })()`);
    return { ok: isStateOn(after, 'digg'), changed: true, state: after, selector: sel };
  }

  async collect(account, { awemeId, url }) {
    await this.assertLogin(account);
    const target = url || `https://www.douyin.com/video/${awemeId}`;
    const { cdp } = await this.host.page(account, target);
    await sleep(2600);
    const sel = await cdp.pick(SEL.collect);
    if (!sel) throw new Error('未找到收藏按钮（选择器需更新）');
    const before = await cdp.evaluate(`(() => { const d = document.querySelector(${JSON.stringify(sel)}); return d ? d.getAttribute('data-e2e-state') || '' : ''; })()`);
    if (isStateOn(before, 'collect')) return { ok: true, changed: false, state: before, note: '已经收藏', selector: sel };
    await cdp.clickSelector(sel);
    await sleep(1500);
    const after = await cdp.evaluate(`(() => { const d = document.querySelector(${JSON.stringify(sel)}); return d ? d.getAttribute('data-e2e-state') || '' : ''; })()`);
    return { ok: isStateOn(after, 'collect'), changed: true, state: after, selector: sel };
  }

  async follow(account, { secUid, url }) {
    await this.assertLogin(account);
    const target = url || `https://www.douyin.com/user/${secUid}`;
    const { cdp } = await this.host.page(account, target);
    await sleep(2600);
    let sel = await cdp.pick(SEL.followBtn);
    // 兜底：按文案找按钮
    if (!sel) {
      const ok = await cdp.evaluate(`(() => {
        const b = [...document.querySelectorAll('button, div[role="button"]')].find(x => /^关注$/.test((x.innerText||'').trim()));
        if (!b) return false;
        b.setAttribute('data-dy-follow', '1'); return true;
      })()`);
      if (ok) sel = '[data-dy-follow="1"]';
    }
    if (!sel) throw new Error('未找到关注按钮（可能已关注或页面结构变化）');
    const before = await cdp.textOf(sel);
    if (/已关注|互相关注/.test(before || '')) return { ok: true, changed: false, state: before, selector: sel };
    await cdp.clickSelector(sel);
    await sleep(1400);
    const after = await cdp.textOf(sel);
    return { ok: /已关注|互相关注/.test(after || ''), changed: true, state: after, selector: sel };
  }

  async comment(account, { awemeId, text, url, dryRun = false }) {
    await this.assertLogin(account);
    const target = url || `https://www.douyin.com/video/${awemeId}`;
    const { cdp } = await this.host.page(account, target);
    await sleep(3200);

    // 1. 展开评论区
    await cdp.clickFirst(SEL.commentIcon);
    await sleep(1200);

    // 2. 点输入区激活焦点（真实页面里它不是 contenteditable，点击后才有可编辑元素）
    const activated = await cdp.evaluate(`(() => {
      const box = document.querySelector('div.comment-input-inner-container')
        || document.querySelector('#merge-all-comment-container')
        || document.querySelector('[class*="comment-input"]');
      if (!box) return false;
      box.click();
      const inner = box.querySelector('[contenteditable="true"], textarea, input');
      if (inner) { inner.focus(); }
      return true;
    })()`);
    if (!activated) throw new Error('未找到评论输入区（评论区可能没展开）');
    await sleep(800);

    // 3. 输入（CDP 直接插到焦点元素，不依赖 contenteditable 选择器）
    await cdp.typeText(text);
    await sleep(800);

    const typed = await cdp.evaluate(`(() => {
      const box = document.querySelector('div.comment-input-inner-container') || document.body;
      const el = box.querySelector('[contenteditable="true"], textarea, input');
      return el ? (el.innerText || el.value || '') : (box.innerText || '').slice(0, 60);
    })()`);

    if (dryRun) {
      // 只验证能否激活输入区并写进去，不发送
      return { ok: String(typed).trim().length > 0, sent: false, typed: String(typed).slice(0, 40), dryRun: true };
    }

    // 4. 发送
    const sent = await cdp.evaluate(`(() => {
      const box = document.querySelector('div.comment-input-container') || document.querySelector('div.comment-input-inner-container');
      if (!box) return false;
      const btns = [...box.querySelectorAll('button, [role="button"], span')];
      const b = btns.find(x => /发送|评论/.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0);
      if (b) { b.click(); return true; }
      const last = btns[btns.length - 1];
      if (last) { last.click(); return true; }
      return false;
    })()`);
    await sleep(1500);

    const left = await cdp.evaluate(`(() => {
      const box = document.querySelector('div.comment-input-inner-container');
      const el = box && box.querySelector('[contenteditable="true"], textarea, input');
      return el ? String(el.innerText || el.value || '').trim() : '';
    })()`);
    return { ok: sent && left.length === 0, sent, typed: String(typed).slice(0, 40), leftover: left };
  }

  async dm(account, { secUid, text, url, dryRun = false }) {
    await this.assertLogin(account);
    const target = url || `https://www.douyin.com/user/${secUid}`;
    const { cdp } = await this.host.page(account, target);
    await sleep(2800);

    // 先确认用户存在，否则后面点到的是别的控件
    const gone = await cdp.evaluate(`/用户不存在|账号已注销/.test((document.body && document.body.innerText) || '')`).catch(() => false);
    if (gone) throw new Error(`该用户不存在或已注销，无法私信：${secUid}`);

    let clicked = await cdp.clickFirst(SEL.dmEntry);
    if (!clicked) {
      // 页面上有隐藏副本（尺寸 0），必须挑可见的那个
      clicked = await cdp.evaluate(`(() => {
        const cands = [...document.querySelectorAll('button, [role="button"], span')]
          .filter(x => /^(私信|发消息)$/.test((x.innerText || '').trim()) && x.getBoundingClientRect().width > 0);
        if (!cands.length) return false;
        const el = cands[cands.length - 1]; // 最内层元素
        el.click();
        return true;
      })()`);
      clicked = clicked ? '[data-dy-dm]' : '';
    }
    if (!clicked) throw new Error('未找到「私信」入口（对方可能设置了不接收私信）');
    await sleep(3000);

    // 面板打开后输入区默认是折叠的（宽高为 0），要先点容器把它激活
    const activated = await cdp.evaluate(`(() => {
      const boxSel = ${JSON.stringify(SEL.dmEditorBox)};
      let box = null;
      for (const s of boxSel) { box = document.querySelector(s); if (box) break; }
      if (!box) return { ok: false };
      box.click();
      const inner = box.querySelector('[contenteditable="true"], [contenteditable], textarea') || box;
      try { inner.focus(); } catch (e) {}
      return { ok: true, inner: inner.tagName + '.' + (inner.className || '').toString().slice(0, 30) };
    })()`);
    if (!activated?.ok) {
      // 再等一会儿，部分账号面板渲染慢
      await sleep(2500);
    }
    const editor = await cdp.pick(SEL.dmInput);
    const focused = await cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(editor || '[contenteditable]')});
      if (!el) return false;
      el.click();
      try { el.focus(); } catch (e) {}
      return true;
    })()`);
    if (!focused) throw new Error('私信输入框未就绪（面板可能没展开，或需要先关注对方）');
    await cdp.typeText(text);
    await sleep(700);
    const typed = await cdp.evaluate(`(() => {
      const el = document.querySelector('[contenteditable="true"], textarea');
      return el ? String(el.innerText || el.value || '') : '';
    })()`);
    if (dryRun) {
      return { ok: String(typed).trim().length > 0, sent: false, dryRun: true, typed: String(typed).slice(0, 40) };
    }
    // 发送前重新聚焦，避免点击面板后焦点丢失导致 Enter 无效
    await cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(editor || '[contenteditable]')});
      if (el) { try { el.focus(); } catch (e) {} }
    })()`);
    await sleep(300);

    let sent = false;
    for (const s of SEL.dmSend) {
      const ok = await cdp.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(s)}); if (!b) return false; b.dispatchEvent(new MouseEvent('click',{bubbles:true})); return true; })()`);
      if (ok) { sent = true; break; }
    }
    if (!sent) await cdp.pressKey('Enter', 'Enter', 13);
    await sleep(2000);

    // 判定：输入框清空 或 面板里出现了刚发的内容
    // 判定：面板里出现刚发的内容即算成功（输入框是折叠 DIV，读不到内容不代表没发）
    const state = await cdp.evaluate(`(() => {
      const box = document.querySelector('[class*="imContainer"]') || document.body;
      const el = document.querySelector(${JSON.stringify(editor || '[contenteditable]')});
      const panel = (box.innerText || '');
      const probe = ${JSON.stringify(String(text).trim().slice(0, 10))};
      return {
        left: el ? String(el.innerText || '').trim() : '',
        echoed: probe.length > 0 && panel.includes(probe),
        tail: panel.slice(-100).replace(/\\s+/g, ' '),
      };
    })()`);
    const ok = state.echoed || String(state.left).length === 0;
    return { ok, sent: true, echoed: !!state.echoed, leftover: state.left, panelTail: String(state.tail || '').slice(-70) };
  }

  /* --------------------------- 粉丝 / 关注列表 --------------------------- */

  async followers(account, opts = {}) {
    return this.relationList(account, { ...opts, kind: 'followers' });
  }

  async following(account, opts = {}) {
    return this.relationList(account, { ...opts, kind: 'following' });
  }

  async relationList(account, { secUid, kind, keyword = '', limit = 300, url: overrideUrl, patterns }) {
    await this.assertLogin(account);
    const { cdp } = await this.host.page(account, overrideUrl || `https://www.douyin.com/user/${secUid}`);
    await sleep(1200);

    // PC 页面已不再渲染粉丝/关注列表，直接走同源接口分页（cookie 自动带，无需自己签名）
    const endpoint = kind === 'followers' ? 'follower/list' : 'following/list';
    const collected = [];
    let minTime = 0;
    let pages = 0;
    let lastError = '';

    while (collected.length < limit && pages < 30) {
      // 实测：offset 不生效，翻页靠 min_time 往前推
      const qs = new URLSearchParams({ sec_user_id: secUid, count: '20', offset: '0', aid: '6383' });
      if (minTime) qs.set('min_time', String(minTime));
      const api = `https://www.douyin.com/aweme/v1/web/user/${endpoint}/?${qs.toString()}`;
      const r = await this.fetchInPage(cdp, api);
      if (!r.json) {
        lastError = r.text || `HTTP ${r.status}`;
        break;
      }
      const list = r.json.followers || r.json.followings || r.json.user_list || r.json.data || [];
      if (!list.length) {
        if (r.json.status_code && r.json.status_code !== 0) lastError = `status_code=${r.json.status_code}`;
        break;
      }
      let added = 0;
      for (const u of list) {
        const p = parseUser(u, { keyword });
        if (p && !collected.some((x) => x.sec_uid === p.sec_uid)) { collected.push(p); added++; }
      }
      pages++;
      const nextMin = r.json.min_time;
      if (!r.json.has_more || !nextMin || nextMin === minTime || added === 0) break;
      minTime = nextMin;
      await sleep(350 + randInt(0, 350));
    }

    const uniq = new Map();
    for (const u of collected) uniq.set(u.sec_uid, u);
    return { users: [...uniq.values()].slice(0, limit), pages, kind, error: lastError };
  }

  /* --------------------------- 私信会话列表 --------------------------- */

  async conversations(account, { limit = 50, url: overrideUrl } = {}) {
    await this.assertLogin(account);
    const { cdp } = await this.host.page(account, overrideUrl || 'https://www.douyin.com/user/self?showTab=message');
    await sleep(6000);

    // 会话列表接口未在页面请求里暴露，改为从渲染后的 DOM 提取
    const rows = await cdp.evaluate(`(() => {
      const items = [...document.querySelectorAll('[class*="ConversationItemwrapper"]')];
      return items.slice(0, 100).map((el, i) => {
        const nameEl = el.querySelector('[class*="rowArea1"]');
        const descEl = el.querySelector('[class*="Descleft"]');
        const timeEl = el.querySelector('[class*="Deschtml"], [class*="DeschintAndTimeWrapper"] > div:last-child');
        const rawName = ((nameEl && (nameEl.textContent || nameEl.innerText)) || '').trim().replace(/\\s+/g, ' ');
        return {
          idx: i,
          nickname: rawName.split(' ')[0].slice(0, 40),
          nameRaw: rawName.slice(0, 60),
          desc: ((descEl && descEl.innerText) || '').trim().slice(0, 120),
          time: ((timeEl && timeEl.innerText) || '').trim().slice(0, 20),
          text: ((el.innerText || '').trim().replace(/\\s+/g, ' ')).slice(0, 160),
        };
      });
    })()`);

    const conversations = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.nickname && !r.desc) continue;
      const key = `${r.nickname}|${r.desc.slice(0, 20)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conversations.push({
        conversation_id: `dom:${r.nickname || r.text.slice(0, 12)}:${i}`,
        nickname: (r.nickname || (r.text || '').replace(r.desc || '', '').trim().slice(0, 24) || '').trim(),
        last_message: r.desc,
        last_time: 0,
        unread: 0,
        raw: r,
        source: 'dom',
      });
    }
    return { conversations: conversations.slice(0, limit), pages: 1, source: 'dom' };
  }

  /* --------------------------- 下载 --------------------------- */

  /** 从页面上下文拿作品详情（比 iesdouyin 接口可靠，未登录也常可用） */
  async awemeDetailFromPage(account, awemeId) {
    const { cdp } = await this.host.page(account);
    const collector = new ResponseCollector(cdp, [
      /aweme\/v1\/web\/aweme\/detail/,
      /aweme\/v1\/web\/aweme\/post/,
      /aweme\/v1\/web\/aweme\/related/,
    ]);
    try {
      await cdp.navigate(`https://www.douyin.com/video/${awemeId}`, { waitMs: 3500 });
      await sleep(2500);
    } finally {
      collector.stop();
    }
    for (const it of collector.items) {
      const j = it.json || {};
      const cand = j.aweme_detail || (Array.isArray(j.aweme_list) ? j.aweme_list.find((a) => String(a?.aweme_id) === String(awemeId)) : null);
      if (cand) return cand;
    }
    return null;
  }

  /** 作品详情 → 统一下载/解析结构 */
  fromDetail(detail) {
    const play = (detail?.video?.play_addr?.url_list || []).map((u) => String(u).replace('/playwm/', '/play/'));
    return {
      aweme_id: String(detail?.aweme_id || ''),
      desc: detail?.desc || '',
      author: detail?.author?.nickname || '',
      cover: detail?.video?.cover?.url_list?.[0] || '',
      video: play[0] || '',
      images: (detail?.images || []).map((i) => i.url_list?.[0]).filter(Boolean),
      music: detail?.music?.play_url?.url_list?.[0] || '',
    };
  }

  async download(account, { shareUrls = [], awemeIds = [], dir }) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const outDir = dir || path.resolve('data', 'downloads', new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    fs.mkdirSync(outDir, { recursive: true });
    const results = [];

    const save = async (url, name) => {
      const r = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          referer: 'https://www.douyin.com/',
        },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const file = path.join(outDir, name);
      fs.writeFileSync(file, buf);
      return { file, size: buf.length };
    };

    const fromDetail = (detail) => {
      const play = (detail?.video?.play_addr?.url_list || [])
        .map((u) => String(u).replace('/playwm/', '/play/'));
      const images = (detail?.images || []).map((i) => i.url_list?.[0]).filter(Boolean);
      return {
        aweme_id: String(detail?.aweme_id || ''),
        desc: detail?.desc || '',
        author: detail?.author?.nickname || '',
        video: play[0] || '',
        images,
        music: detail?.music?.play_url?.url_list?.[0] || '',
      };
    };

    const handleOne = async (id) => {
      let info = null;
      try {
        const detail = await this.awemeDetailFromPage(account, id);
        if (detail) info = { ok: true, ...fromDetail(detail), source: 'page' };
      } catch (e) {
        logger.warn('douyin', `页面取详情失败 ${id}: ${e.message}`);
      }
      if (!info) {
        const r = await this.resolveShare(`https://www.douyin.com/video/${id}`);
        if (r.ok) info = r;
        else return { ok: false, aweme_id: id, reason: r.reason };
      }
      const files = [];
      if (info.video) {
        try { files.push(await save(info.video, `${id}.mp4`)); } catch (e) { logger.warn('douyin', `视频下载失败 ${id}: ${e.message}`); }
      }
      for (let i = 0; i < (info.images?.length || 0); i++) {
        try { files.push(await save(info.images[i], `${id}_${i + 1}.jpg`)); } catch { /* 单张失败跳过 */ }
      }
      if (info.music) {
        try { files.push(await save(info.music, `${id}.mp3`)); } catch { /* 跳过 */ }
      }
      return { ok: files.length > 0, aweme_id: id, desc: info.desc, files, source: info.source };
    };

    const ids = new Set(awemeIds.map(String));
    for (const u of shareUrls) {
      try {
        const r = await this.resolveShare(u);
        if (r.aweme_id) ids.add(String(r.aweme_id));
        else results.push({ ok: false, url: u, reason: r.reason });
      } catch (e) {
        results.push({ ok: false, url: u, reason: e.message });
      }
    }
    for (const id of ids) {
      try { results.push(await handleOne(id)); }
      catch (e) { results.push({ ok: false, aweme_id: id, reason: e.message }); }
    }
    return { dir: outDir, results };
  }

  /* --------------------------- 分享链接 / 去水印 --------------------------- */

  async resolveShare(shareUrl, opts = {}) {
    let url = shareUrl.trim();
    const m = url.match(/https?:\/\/[^\s，,]+/);
    if (m) url = m[0];
    let awemeId = '';
    let finalUrl = url;

    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } });
      finalUrl = r.url || url;
      const html = await r.text();
      // 链接本身可能就带 modal_id / item_ids（精选页、分享页常见）
      const hit = finalUrl.match(/\/video\/(\d{8,})/)
        || finalUrl.match(/(?:aweme_id|item_ids?|modal_id)=(\d{8,})/)
        || html.match(/(?:aweme_id|item_ids?|modal_id)[=":\s]+(\d{8,})/);
      if (hit) awemeId = hit[1];
    } catch (e) {
      logger.warn('douyin', `短链解析失败: ${e.message}`);
    }

    if (!awemeId) return { ok: false, reason: '未从链接中解析到作品 ID', finalUrl };

    // iesdouyin 接口已基本失效，优先用页面上下文取详情（需要账号）
    if (opts.account) {
      try {
        const detail = await this.awemeDetailFromPage(opts.account, awemeId);
        if (detail) {
          const out = this.fromDetail(detail);
          return { ok: true, ...out, aweme_id: awemeId, source: 'page' };
        }
      } catch (e) {
        logger.warn('douyin', `页面取详情失败 ${awemeId}: ${e.message}`);
      }
    }

    const candidates = [
      `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${awemeId}`,
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}`,
    ];
    for (const api of candidates) {
      try {
        const r = await fetch(api, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.douyin.com/' } });
        const j = await r.json();
        const item = j?.item_list?.[0] || j?.aweme_detail;
        if (item) {
          const play = item.video?.play_addr?.url_list || [];
          const noWm = play.map((u) => String(u).replace('playwm', 'play'));
          return {
            ok: true,
            aweme_id: awemeId,
            desc: item.desc || '',
            author: item.author?.nickname || '',
            cover: item.video?.cover?.url_list?.[0] || '',
            music: item.music?.play_url?.url_list?.[0] || '',
            video: noWm[0] || play[0] || '',
            images: (item.images || []).map((i) => i.url_list?.[0]).filter(Boolean),
            source: api,
          };
        }
      } catch { /* try next */ }
    }
    return { ok: false, aweme_id: awemeId, reason: '接口未返回数据（可能需要登录态或接口变更）', finalUrl };
  }
}
