import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  Cdp, findChrome, launchChrome, waitEndpoint, listTargets, newTab, closeTab,
} from './cdp.js';
import { sleep, logger, resolveDataPath, ensureDir } from './util.js';
import { updateAccount, getAccount } from './db.js';
import { applyFingerprint, fingerprintProfile } from './fingerprint.js';

export class BrowserHost {
  constructor(config) {
    this.config = config;
    this.chromePath = findChrome(config);
    this.sessions = new Map(); // accountId -> { proc, cdp, port, profileDir, tabId }
  }

  profileDirFor(account) {
    if (account.profile_dir && account.profile_dir.trim()) return account.profile_dir;
    const dir = resolveDataPath(this.config, 'profiles', `acc_${account.id}`);
    ensureDir(dir);
    return dir;
  }

  async isAlive(port) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async ensure(account, { headless } = {}) {
    const id = Number(account.id);
    const cached = this.sessions.get(id);
    if (cached && !cached.closed && (await this.isAlive(cached.port))) return cached;

    if (!this.chromePath) throw new Error('未找到 Chrome / Edge，请在设置里填写浏览器路径');

    const port = cached?.port || account.cdp_port || (9300 + id);
    const profileDir = this.profileDirFor(account);
    ensureDir(profileDir);

    const alive = await this.isAlive(port);
    let proc = null;
    if (!alive) {
      logger.info('browser', `启动浏览器 #${id} port=${port} profile=${profileDir}`);
      proc = launchChrome({
        chromePath: this.chromePath,
        profileDir,
        port,
        headless: headless ?? this.config.headless,
        proxy: account.proxy || undefined,
        width: this.config.windowWidth,
        height: this.config.windowHeight,
      });
      const ep = await waitEndpoint(port, 25000);
      if (!ep) throw new Error(`浏览器端口 ${port} 未就绪（可能被其它实例占用）`);
    }

    const session = { proc, port, profileDir, cdp: null, tabId: null, closed: false };
    this.sessions.set(id, session);
    updateAccount(id, { status: 'running' });
    return session;
  }

  async page(account, url, { forceNew = false } = {}) {
    const session = await this.ensure(account);
    let target = null;

    if (!forceNew && session.tabId) {
      const list = await listTargets(session.port);
      target = list.find((t) => t.id === session.tabId && t.type === 'page');
    }
    if (!target) {
      // Chrome 刚起来时可能还没有 page target，重试几次
      let pages = [];
      for (let i = 0; i < 6; i++) {
        pages = (await listTargets(session.port)).filter((t) => t.type === 'page');
        if (pages.length) break;
        await sleep(400);
      }
      if (!pages.length) {
        const created = await newTab(session.port, url || 'about:blank');
        if (created) pages = [created];
      }
      const douyin = pages.find((t) => /douyin\.com/.test(t.url));
      target = douyin || pages[0];
      for (const p of pages) {
        if (p.id !== target?.id && (/^about:blank$/.test(p.url) || p.url === '')) {
          await closeTab(session.port, p.id);
        }
      }
    }
    if (!target?.webSocketDebuggerUrl) throw new Error('未取到可用标签页');

    let cdp = session.cdp;
    if (!cdp || cdp.closed || cdp.wsUrl !== target.webSocketDebuggerUrl) {
      if (cdp) cdp.close();
      cdp = await Cdp.connect(target.webSocketDebuggerUrl);
      await cdp.enable();
      cdp.wsUrl = target.webSocketDebuggerUrl;
      session.cdp = cdp;
      session.tabId = target.id;
      // 指纹注入（每个账号固定 seed，换账号即换画像）
      const seed = account.seed || `acc-${account.id}`;
      try {
        cdp.fingerprint = await applyFingerprint(cdp, fingerprintProfile(seed));
        logger.info('browser', `指纹已应用 #${account.id}: ${cdp.fingerprint.ua.match(/Chrome\/[\d.]+/)?.[0] || ''} ${cdp.fingerprint.timezone} ${cdp.fingerprint.width}x${cdp.fingerprint.height}`);
      } catch (e) {
        logger.warn('browser', `指纹注入失败 #${account.id}: ${e.message}`);
      }
    }

    if (url) {
      await cdp.navigate(url, { waitMs: 900 });
    } else {
      // 没指定地址时，别把用户丢在空白页
      try {
        const cur = await cdp.evaluate('location.href');
        if (!cur || cur === 'about:blank') await cdp.navigate('https://www.douyin.com/', { waitMs: 900 });
      } catch { /* ignore */ }
    }
    return { cdp, session };
  }

  async cookies(account, urls = ['https://www.douyin.com', 'https://live.douyin.com']) {
    const { cdp } = await this.page(account);
    return cdp.getCookies(urls);
  }

  async checkLogin(account) {
    const id = Number(account.id);
    try {
      const cookies = await this.cookies(account);
      const has = (n) => cookies.some((c) => c.name === n && String(c.value || '').length > 8);
      const loggedIn = has('sessionid') || has('sessionid_ss') || has('sid_tt');
      let nickname = '';
      let secUid = '';
      try {
        const { cdp } = await this.page(account);
        const info = await cdp.evaluate(`(() => {
          try {
            const m = document.querySelector('div[data-e2e="user-info"] h1');
            return { nickname: m ? m.innerText.trim() : '', href: location.href };
          } catch (e) { return { nickname: '', href: location.href }; }
        })()`);
        nickname = info?.nickname || '';
      } catch { /* ignore */ }
      updateAccount(id, {
        logged_in: loggedIn ? 1 : 0,
        status: 'online',
        nickname: nickname || account.nickname || '',
        last_seen: Date.now(),
      });
      return { loggedIn, nickname, cookies: cookies.length };
    } catch (e) {
      updateAccount(id, { status: 'error', last_seen: Date.now() });
      logger.warn('browser', `检查登录失败 #${id}: ${e.message}`);
      return { loggedIn: false, nickname: '', cookies: 0, error: e.message };
    }
  }

  async openLogin(account) {
    const { cdp } = await this.page(account, 'https://www.douyin.com/');
    await sleep(1200);
    // 优先点右上角"登录"，把扫码框弹出来
    const clicked = await cdp.evaluate(`(() => {
      const el = document.querySelector('#douyin-header-menuCt button, button[data-e2e="login-button"], div[data-e2e="login-button"]');
      if (el) { el.click(); return true; }
      const txt = [...document.querySelectorAll('button, span, div')].find(n => n.innerText && n.innerText.trim() === '登录');
      if (txt) { txt.click(); return true; }
      return false;
    })()`);
    logger.info('browser', `已打开登录页 #${account.id}，扫码入口=${clicked}`);
    return { ok: true, clicked };
  }

  async stop(accountId) {
    const id = Number(accountId);
    const s = this.sessions.get(id);
    if (!s) return false;
    try { s.cdp?.close(); } catch { /* ignore */ }
    s.closed = true;
    this.sessions.delete(id);
    // 只关掉我们拉起来的浏览器进程
    if (s.proc && !s.proc.killed) {
      try { s.proc.kill(); } catch { /* ignore */ }
    } else {
      try {
        const acct = getAccount(id);
        if (acct) {
          await fetch(`http://127.0.0.1:${s.port}/json/version`).catch(() => {});
        }
      } catch { /* ignore */ }
    }
    updateAccount(id, { status: 'offline' });
    return true;
  }

  async shutdown() {
    for (const [id, s] of [...this.sessions.entries()]) {
      try { s.cdp?.close(); } catch { /* ignore */ }
      try { s.proc?.kill(); } catch { /* ignore */ }
      this.sessions.delete(id);
    }
  }
}
