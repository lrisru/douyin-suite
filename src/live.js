import { parsePushFrame, parseResponse, parseWebcastMessage, extractStrings } from './protobuf.js';
import { insertLiveMessage, pruneLiveMessages } from './db.js';
import { logger, events } from './util.js';

/**
 * 直播间弹幕旁路监听：
 * 打开直播间页面 → 页面自己建 WebSocket 收 push 帧 → 我们通过 CDP 旁路读帧 → protobuf 解码。
 * 不需要自己签名、不需要 ack（ack 由页面负责）。
 */
export class LiveStream {
  constructor({ host, account, webRid, roomId = '', onMessage }) {
    this.host = host;
    this.account = account;
    this.webRid = String(webRid || '');
    this.roomId = String(roomId || '');
    this.onMessage = onMessage || (() => {});
    this.cdp = null;
    this.off = null;
    this.buffer = [];
    this.stats = { chat: 0, gift: 0, member: 0, like: 0, other: 0, frames: 0 };
    this.startedAt = 0;
    this.timer = null;
    this.active = false;
  }

  async start() {
    const url = `https://live.douyin.com/${this.webRid}`;
    const { cdp } = await this.host.page(this.account, url);
    this.cdp = cdp;
    await new Promise((r) => setTimeout(r, 2500));

    // 拿 room_id 与在线数（进房接口）
    try {
      const r = await cdp.evaluate(`(() => {
        const el = document.querySelector('span[data-e2e="live-room-title"], h1');
        return { title: el ? el.innerText.trim() : '', href: location.href };
      })()`);
      this.title = r?.title || '';
    } catch { /* ignore */ }

    this.off = cdp.on('Network.webSocketFrameReceived', (p) => this.handleFrame(p));
    this.timer = setInterval(() => this.flush(), 1500);
    this.startedAt = Date.now();
    this.active = true;
    logger.ok('live', `开始监听直播间 ${this.webRid}（账号 #${this.account.id}）`);
    return this;
  }

  handleFrame(p) {
    const data = p?.response?.payloadData;
    if (!data) return;
    let buf;
    try { buf = Buffer.from(data, 'base64'); } catch { return; }
    if (!buf.length) return;
    this.stats.frames++;

    let frame = null;
    try { frame = parsePushFrame(buf); } catch { return; }
    if (!frame?.payload) return;

    let resp = null;
    try { resp = parseResponse(frame.payload); } catch { return; }
    if (!resp?.messages?.length) return;

    for (const m of resp.messages) {
      let msg;
      try { msg = parseWebcastMessage(m.method, m.payload); } catch { continue; }
      this.stats[msg.type] = (this.stats[msg.type] || 0) + 1;
      if (msg.type === 'online' && msg.extra?.online) this.online = msg.extra.online;

      // 认不出的类型：兜底抽取可读文本，避免整条丢弃
      if (msg.type === 'other') {
        const strs = extractStrings(m.payload || Buffer.alloc(0)).filter((s) => /[\u4e00-\u9fff]/.test(s));
        if (!strs.length) continue;
        msg.content = strs.slice(0, 2).join(' / ');
        msg.user = msg.user || null;
      }

      const rec = {
        account_id: this.account.id,
        web_rid: this.webRid,
        room_id: this.roomId,
        type: msg.type,
        method: msg.method,
        user_name: msg.user?.nickname || '',
        user_id: msg.user?.id || '',
        content: msg.content || '',
        extra: msg.extra || {},
        ts: Date.now(),
      };
      this.buffer.push(rec);
      if (this.buffer.length >= 80) this.flush();
      this.onMessage(rec);
    }
  }

  flush() {
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      for (const r of batch) insertLiveMessage(r);
      events.emit('live', { web_rid: this.webRid, count: batch.length, stats: this.stats });
    } catch (e) {
      logger.warn('live', `弹幕入库失败: ${e.message}`);
    }
  }

  snapshot() {
    return {
      active: this.active,
      web_rid: this.webRid,
      room_id: this.roomId,
      title: this.title || '',
      online: this.online || 0,
      started_at: this.startedAt,
      stats: { ...this.stats },
      buffer: this.buffer.length,
    };
  }

  stop() {
    this.active = false;
    clearInterval(this.timer);
    try { this.off?.(); } catch { /* ignore */ }
    this.flush();
    pruneLiveMessages();
    logger.info('live', `停止监听直播间 ${this.webRid}`);
    return this.snapshot();
  }
}

/** 全局单例管理，便于 HTTP 层启停 */
export class LiveManager {
  constructor(host) {
    this.host = host;
    this.sessions = new Map(); // web_rid -> LiveStream
  }

  async start(account, webRid, { onMessage } = {}) {
    const key = String(webRid);
    if (this.sessions.has(key)) return this.sessions.get(key);
    const s = new LiveStream({ host: this.host, account, webRid: key, onMessage });
    await s.start();
    this.sessions.set(key, s);
    return s;
  }

  stop(webRid) {
    const s = this.sessions.get(String(webRid));
    if (!s) return null;
    const snap = s.stop();
    this.sessions.delete(String(webRid));
    return snap;
  }

  stopAll() {
    for (const [k] of this.sessions) this.stop(k);
  }

  list() {
    return [...this.sessions.values()].map((s) => s.snapshot());
  }

  get(webRid) {
    return this.sessions.get(String(webRid)) || null;
  }
}
