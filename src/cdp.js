import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { sleep } from './util.js';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export function findChrome(config = {}) {
  if (config.chrome && fs.existsSync(config.chrome)) return config.chrome;
  for (const p of CHROME_CANDIDATES) {
    try { if (p && fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return '';
}

async function httpJson(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

export async function waitEndpoint(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = await httpJson(`http://127.0.0.1:${port}/json/version`);
      if (v?.webSocketDebuggerUrl) return v;
    } catch { /* not ready */ }
    await sleep(250);
  }
  return null;
}

export function launchChrome({ chromePath, profileDir, port, headless, proxy, width = 1280, height = 860, extraArgs = [] }) {
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--disable-infobars',
    `--window-size=${width},${height}`,
    '--lang=zh-CN',
    '--disable-popup-blocking',
  ];
  if (proxy) args.push(`--proxy-server=${proxy}`);
  if (headless) args.push('--headless=new', '--disable-gpu', '--mute-audio');
  args.push(...extraArgs, 'about:blank');

  const proc = spawn(chromePath, args, { detached: false, stdio: 'ignore' });
  proc.on('error', () => {});
  return proc;
}

export async function listTargets(port) {
  try {
    const t = await httpJson(`http://127.0.0.1:${port}/json/list`);
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

export async function newTab(port, url = 'about:blank') {
  const tryMethods = ['PUT', 'POST', 'GET'];
  for (const m of tryMethods) {
    try {
      const t = await httpJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: m });
      if (t?.webSocketDebuggerUrl) return t;
    } catch { /* try next */ }
  }
  const list = await listTargets(port);
  const page = list.find((x) => x.type === 'page');
  return page || null;
}

export async function closeTab(port, id) {
  try { await httpJson(`http://127.0.0.1:${port}/json/close/${id}`); } catch { /* ignore */ }
}

/* ----------------------------- CDP session ----------------------------- */

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this._onMessage(ev));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const [, p] of this.pending) p.reject(new Error('cdp closed'));
      this.pending.clear();
    });
  }

  static async connect(wsUrl, timeoutMs = 8000) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('cdp connect timeout')), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error('cdp connect error')); }, { once: true });
    });
    return new Cdp(ws);
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else p.resolve(msg.result);
      return;
    }
    const list = this.handlers.get(msg.method);
    if (list) for (const cb of list) { try { cb(msg.params); } catch { /* ignore */ } }
  }

  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(cb);
    return () => {
      const arr = this.handlers.get(method) || [];
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('cdp closed'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cdp timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, { awaitPromise = true, returnByValue = true, timeoutMs = 30000 } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue,
      userGesture: true,
      includeCommandLineAPI: false,
    }, timeoutMs);
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'evaluate error');
    }
    return r?.result?.value;
  }

  async enable({ network = true, page = true, runtime = true } = {}) {
    const jobs = [];
    if (runtime) jobs.push(this.send('Runtime.enable'));
    if (page) jobs.push(this.send('Page.enable'));
    if (network) jobs.push(this.send('Network.enable', { maxTotalBufferSize: 20_000_000, maxResourceBufferSize: 10_000_000 }));
    await Promise.all(jobs);
  }

  async navigate(url, { waitMs = 1500, timeoutMs = 45000 } = {}) {
    await this.send('Page.navigate', { url }, timeoutMs);
    await sleep(waitMs);
  }

  async getCookies(urls = ['https://www.douyin.com']) {
    const r = await this.send('Network.getCookies', { urls });
    return r?.cookies || [];
  }

  async setCookie(cookie) {
    const r = await this.send('Network.setCookie', cookie);
    return r?.success;
  }

  async clearCookies() {
    await this.send('Network.clearBrowserCookies');
  }

  async clickSelector(selector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) {
      // 元素存在但不可见（尺寸为 0）时，退化为页面内同步点击
      return this.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    return true;
  }

  async clickPoint(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  /** 依次尝试候选选择器，返回第一个存在的 */
  async pick(selectors) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const s of list) {
      if (!s) continue;
      try {
        const ok = await this.evaluate(`(() => !!document.querySelector(${JSON.stringify(s)}))()`);
        if (ok) return s;
      } catch { /* 继续下一个 */ }
    }
    return '';
  }

  /** 点击第一个可用的候选选择器 */
  async clickFirst(selectors) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const s of list) {
      if (!s) continue;
      try {
        if (await this.clickSelector(s)) return s;
      } catch { /* 继续 */ }
    }
    return '';
  }

  /** 读取第一个命中元素的 innerText */
  async textOf(selectors) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const s of list) {
      if (!s) continue;
      try {
        const t = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(s)}); return el ? (el.innerText || '').trim() : null; })()`);
        if (t != null) return t;
      } catch { /* 继续 */ }
    }
    return null;
  }

  async typeText(text) {
    await this.send('Input.insertText', { text });
  }

  async pressKey(key, code = key, keyCode = 0) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
    await sleep(30);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  }

  async screenshot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    if (r?.data) fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
    this.closed = true;
  }
}

/* ----------------------------- response capture ----------------------------- */

export class ResponseCollector {
  constructor(cdp, matchers) {
    this.cdp = cdp;
    this.matchers = matchers.map((m) => (m instanceof RegExp ? m : new RegExp(m)));
    this.meta = new Map();
    this.items = [];
    this.watchers = [];
    this.off = cdp.on('Network.responseReceived', (p) => this._onResponse(p));
    this.off2 = cdp.on('Network.loadingFinished', (p) => this._onFinished(p));
  }

  _match(url) {
    return this.matchers.some((m) => m.test(url));
  }

  _onResponse(p) {
    const url = p?.response?.url || '';
    if (!this._match(url)) return;
    this.meta.set(p.requestId, { url, status: p.response.status, mimeType: p.response.mimeType });
  }

  async _onFinished(p) {
    const m = this.meta.get(p.requestId);
    if (!m) return;
    this.meta.delete(p.requestId);
    try {
      const body = await this.cdp.send('Network.getResponseBody', { requestId: p.requestId }, 15000);
      const text = body?.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body?.body;
      if (!text) return;
      let json = null;
      try { json = JSON.parse(text); } catch { return; }
      const entry = { url: m.url, status: m.status, json, at: Date.now() };
      this.items.push(entry);
      for (const w of this.watchers) { try { w(entry); } catch { /* ignore */ } }
    } catch { /* body 可能已释放 */ }
  }

  watch(fn) {
    this.watchers.push(fn);
    return () => {
      const i = this.watchers.indexOf(fn);
      if (i >= 0) this.watchers.splice(i, 1);
    };
  }

  stop() {
    try { this.off?.(); } catch { /* ignore */ }
    try { this.off2?.(); } catch { /* ignore */ }
    this.watchers = [];
  }
}
