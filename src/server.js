import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initDb, listAccounts, createAccount, getAccount, updateAccount, deleteAccount,
  listTasks, getTask, queryRows, countRows, stats, queryLogs,
  listProxies, addProxy, removeProxy, insertLog, pruneLogs,
  listSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedule,
  queryLiveMessages,
} from './db.js';
import { BrowserHost } from './browser.js';
import { DouyinService } from './douyin.js';
import { TaskEngine } from './tasks.js';
import { LiveManager } from './live.js';
import { Scheduler } from './scheduler.js';
import { fingerprintProfile } from './fingerprint.js';
import { EXPORT_SCHEMAS, toCsv, toXlsx } from './export.js';
import { checkProxy, checkAll, testProxy } from './proxy.js';
import { checkIp } from './ip.js';
import { licenseStatus, activate, machineCode } from './license.js';
import { notifyTest } from './notify.js';
import { events, logger, loadConfig, saveConfig, openInBrowser } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');

const config = loadConfig(ROOT);
initDb(config);

const host = new BrowserHost(config);
const douyin = new DouyinService(host, config);
const liveManager = new LiveManager(host);
const engine = new TaskEngine({ douyin, config, liveManager });
const scheduler = new Scheduler({ engine, config });

events.on('log', (item) => insertLog(item));
setInterval(() => pruneLogs(5000), 5 * 60 * 1000).unref();

/* ------------------------------ helpers ------------------------------ */

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj ?? null);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('JSON 解析失败: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.join(WEB, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}

function parseCookies(text) {
  const out = [];
  for (const part of String(text).split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name) out.push({ name, value });
  }
  return out;
}

/* ------------------------------ routes ------------------------------ */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  // 授权门禁：开了 license.enabled 且未激活时，除「读状态/读设置/激活」外全部拦下
  const lic = licenseStatus(config);
  if (lic.enabled && !lic.valid) {
    const allowed = p === '/api/license' || p === '/api/license/activate' || p === '/api/stats' || p === '/api/settings';
    if (!allowed) {
      return sendJson(res, 403, { ok: false, error: `未授权：${lic.reason || '请先激活'}（设置 → 授权）` });
    }
  }

  const id = (() => {
    const m = p.match(/\/api\/accounts\/(\d+)/) || p.match(/\/api\/proxies\/(\d+)/) || p.match(/\/api\/tasks\/(\d+)/);
    return m ? Number(m[1]) : 0;
  })();

  /* 概览 */
  if (p === '/api/stats') {
    const s = stats();
    return sendJson(res, 200, { ok: true, data: { ...s, queue: engine.queue.length, running: engine.running, license: licenseStatus(config) } });
  }

  /* SSE */
  if (p === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const onLog = (item) => res.write(`event: log\ndata: ${JSON.stringify(item)}\n\n`);
    const onTask = (t) => res.write(`event: task\ndata: ${JSON.stringify(t)}\n\n`);
    const onLive = (m) => res.write(`event: live-message\ndata: ${JSON.stringify(m)}\n\n`);
    events.on('log', onLog);
    events.on('task', onTask);
    events.on('live-message', onLive);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      events.off('log', onLog);
      events.off('task', onTask);
      events.off('live-message', onLive);
    });
    return;
  }

  /* 账号 */
  if (p === '/api/accounts' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, data: listAccounts() });
  }
  if (p === '/api/accounts' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.name) return sendJson(res, 400, { ok: false, error: '请填写账号名称' });
    const accs = listAccounts();
    const nextPort = 9300 + accs.length + 1;
    const acc = createAccount({ name: body.name, note: body.note || '', profile_dir: '', cdp_port: body.port || nextPort });
    updateAccount(acc.id, { profile_dir: path.join(path.resolve(config.dataDir), 'profiles', `acc_${acc.id}`) });
    logger.info('account', `新增账号 #${acc.id} ${acc.name}`);
    return sendJson(res, 200, { ok: true, data: getAccount(acc.id) });
  }
  if (id && p.startsWith('/api/accounts/')) {
    const acc = getAccount(id);
    if (!acc) return sendJson(res, 404, { ok: false, error: '账号不存在' });
    if (req.method === 'DELETE') {
      await host.stop(id);
      deleteAccount(id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST') {
      const action = p.split('/').pop();
      if (action === 'login') {
        const r = await host.openLogin(acc);
        return sendJson(res, 200, { ok: true, data: r });
      }
      if (action === 'check') {
        const r = await host.checkLogin(acc);
        return sendJson(res, 200, { ok: true, data: r });
      }
      if (action === 'stop') {
        await host.stop(id);
        return sendJson(res, 200, { ok: true });
      }
      if (action === 'cookie') {
        const body = await readBody(req);
        const cookies = parseCookies(body.cookie || '');
        if (!cookies.length) return sendJson(res, 400, { ok: false, error: '没有解析到 Cookie' });
        const { cdp } = await host.page(acc, 'https://www.douyin.com/');
        let n = 0;
        for (const c of cookies) {
          const okSet = await cdp.setCookie({ ...c, domain: '.douyin.com', path: '/' }).catch(() => false);
          if (okSet) n++;
        }
        const st = await host.checkLogin(acc);
        return sendJson(res, 200, { ok: true, data: { set: n, ...st } });
      }
      if (action === 'fingerprint') {
        return sendJson(res, 200, { ok: true, data: fingerprintProfile(acc.seed || `acc-${acc.id}`) });
      }
      if (action === 'proxy') {
        const body = await readBody(req);
        updateAccount(id, { proxy: String(body.proxy || '').trim() });
        logger.info('account', `账号 #${id} 代理已设置：${body.proxy || '(已清空)'}`);
        return sendJson(res, 200, { ok: true, data: getAccount(id) });
      }
    }
  }

  /* 任务 */
  if (p === '/api/tasks' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, data: listTasks(Number(q.get('limit') || 100)) });
  }
  if (p === '/api/tasks' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.type) return sendJson(res, 400, { ok: false, error: '缺少任务类型' });
    const t = engine.enqueue(body.type, body.params || {}, body.account_id || null);
    return sendJson(res, 200, { ok: true, data: t });
  }
  if (id && p.endsWith('/run') && req.method === 'POST') {
    const t = getTask(id);
    if (!t) return sendJson(res, 404, { ok: false, error: '任务不存在' });
    const nt = engine.enqueue(t.type, JSON.parse(t.params || '{}'), t.account_id);
    return sendJson(res, 200, { ok: true, data: nt });
  }
  if (id && p.endsWith('/cancel') && req.method === 'POST') {
    const r = engine.cancel(id);
    return sendJson(res, 200, { ok: true, data: r });
  }

  /* 直播弹幕 */
  if (p === '/api/live' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, data: liveManager.list() });
  }
  if (p === '/api/live/start' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.web_rid) return sendJson(res, 400, { ok: false, error: '缺少 web_rid' });
    const accs = listAccounts();
    const acc = body.account_id ? getAccount(body.account_id) : accs.find((a) => a.logged_in === 1) || accs[0];
    if (!acc) return sendJson(res, 400, { ok: false, error: '先添加账号' });
    const s = await liveManager.start(acc, body.web_rid, {
      onMessage: (m) => events.emit('live-message', { ...m, web_rid: String(body.web_rid) }),
    });
    return sendJson(res, 200, { ok: true, data: s.snapshot() });
  }
  if (p === '/api/live/stop' && req.method === 'POST') {
    const body = await readBody(req);
    const snap = liveManager.stop(body.web_rid);
    return sendJson(res, 200, { ok: true, data: snap });
  }
  if (p === '/api/live/messages' && req.method === 'GET') {
    const rows = queryLiveMessages({
      web_rid: q.get('web_rid') || '',
      type: q.get('type') || '',
      limit: Number(q.get('limit') || 200),
      after_id: Number(q.get('after_id') || 0),
    });
    return sendJson(res, 200, { ok: true, data: rows });
  }

  /* 定时任务 */
  if (p === '/api/schedules' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, data: listSchedules() });
  }
  if (p === '/api/schedules' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.type) return sendJson(res, 400, { ok: false, error: '缺少任务类型' });
    const s = createSchedule({
      name: body.name || body.type,
      type: body.type,
      params: body.params || {},
      account_ids: Array.isArray(body.account_ids) ? body.account_ids.join(',') : String(body.account_ids || ''),
      interval_min: Number(body.interval_min) || 60,
    });
    logger.info('schedule', `新增定时任务「${s.name}」每 ${s.interval_min} 分钟`);
    return sendJson(res, 200, { ok: true, data: s });
  }
  {
    const m = p.match(/^\/api\/schedules\/(\d+)$/);
    if (m) {
      const sid = Number(m[1]);
      const s = getSchedule(sid);
      if (!s) return sendJson(res, 404, { ok: false, error: '定时任务不存在' });
      if (req.method === 'DELETE') {
        deleteSchedule(sid);
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const fields = {};
        if (body.enabled != null) fields.enabled = body.enabled ? 1 : 0;
        if (body.interval_min) { fields.interval_min = Number(body.interval_min); fields.next_run = Date.now() + Number(body.interval_min) * 60000; }
        if (body.run_now) {
          const params = JSON.parse(s.params || '{}');
          const ids = String(s.account_ids || '').split(',').map(Number).filter(Boolean);
          const t = engine.enqueue(s.type, params, ids[0] || s.account_id || null);
          updateSchedule(sid, { last_run: Date.now(), last_task_id: t.id });
          return sendJson(res, 200, { ok: true, data: { triggered: t.id } });
        }
        return sendJson(res, 200, { ok: true, data: updateSchedule(sid, fields) });
      }
    }
  }

  /* 数据 */
  if (p.startsWith('/api/data/') && req.method === 'GET') {
    const kind = p.split('/').pop();
    const opts = {
      limit: Number(q.get('limit') || 200),
      offset: Number(q.get('offset') || 0),
      keyword: q.get('keyword') || '',
      task_id: Number(q.get('task_id') || 0),
      account_id: Number(q.get('account_id') || 0),
      from: Number(q.get('from') || 0),
      to: Number(q.get('to') || 0),
    };
    const rows = queryRows(kind, opts);
    const total = countRows(kind, opts);
    return sendJson(res, 200, { ok: true, data: rows, total, columns: EXPORT_SCHEMAS[kind]?.columns.map((c) => ({ key: c.key, label: c.label })) || [] });
  }

  /* 导出 */
  if (p === '/api/export') {
    const kind = q.get('kind') || 'items';
    const format = (q.get('format') || 'xlsx').toLowerCase();
    const rows = queryRows(kind, {
      limit: 200000,
      keyword: q.get('keyword') || '',
      task_id: Number(q.get('task_id') || 0),
      from: Number(q.get('from') || 0),
      to: Number(q.get('to') || 0),
    });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    if (format === 'csv') {
      const buf = Buffer.from(toCsv(kind, rows), 'utf8');
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="douyin_${kind}_${stamp}.csv"`,
      });
      return res.end(buf);
    }
    const buf = toXlsx(EXPORT_SCHEMAS[kind].columns, rows, EXPORT_SCHEMAS[kind].sheet);
    res.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="douyin_${kind}_${stamp}.xlsx"`,
    });
    return res.end(buf);
  }

  /* 代理 */
  if (p === '/api/proxies' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, data: listProxies() });
  }
  if (p === '/api/proxies' && req.method === 'POST') {
    const body = await readBody(req);
    const list = String(body.url || '').split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
    for (const u of list) addProxy(u);
    return sendJson(res, 200, { ok: true, added: list.length });
  }
  if (p === '/api/proxies/check-all' && req.method === 'POST') {
    const r = await checkAll();
    return sendJson(res, 200, { ok: true, data: r });
  }
  if (id && p.startsWith('/api/proxies/') && req.method === 'DELETE') {
    removeProxy(id);
    return sendJson(res, 200, { ok: true });
  }
  if (id && p.endsWith('/check') && p.startsWith('/api/proxies/') && req.method === 'POST') {
    const list = listProxies();
    const item = list.find((x) => x.id === id);
    if (!item) return sendJson(res, 404, { ok: false, error: '代理不存在' });
    const r = await checkProxy(id, item.url);
    return sendJson(res, 200, { ok: true, data: r });
  }
  if (p === '/api/proxies/test' && req.method === 'POST') {
    const body = await readBody(req);
    const r = await testProxy(body.url);
    return sendJson(res, 200, { ok: true, data: r });
  }

  /* 设置 */
  if (p === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      data: {
        chrome: config.chrome, headless: config.headless, port: config.port,
        task: config.task, notify: config.notify, license: { enabled: !!config.license.enabled },
        dataDir: path.resolve(config.dataDir),
      },
    });
  }
  if (p === '/api/settings' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.chrome != null) config.chrome = body.chrome;
    if (body.headless != null) config.headless = !!body.headless;
    if (body.task) Object.assign(config.task, body.task);
    if (body.notify) Object.assign(config.notify, body.notify);
    if (body.license && body.license.enabled != null) config.license.enabled = !!body.license.enabled;
    saveConfig(ROOT, config);
    if (body.chrome != null) host.chromePath = body.chrome || host.chromePath;
    logger.info('setting', '配置已保存');
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/notify/test' && req.method === 'POST') {
    const r = await notifyTest(config);
    return sendJson(res, 200, { ok: true, data: r });
  }

  /* 授权 */
  if (p === '/api/license' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, data: { ...licenseStatus(config), machine: machineCode() } });
  }
  if (p === '/api/license/activate' && req.method === 'POST') {
    const body = await readBody(req);
    const r = activate(config, body.key || '');
    if (!r.ok) return sendJson(res, 400, { ok: false, error: r.reason });
    return sendJson(res, 200, { ok: true, data: r });
  }

  /* 分享链接解析 */
  if (p === '/api/parse' && req.method === 'POST') {
    const body = await readBody(req);
    const accs = listAccounts();
    const acc = body.account_id ? getAccount(body.account_id) : (accs.find((a) => a.logged_in === 1) || accs[0] || null);
    const r = await douyin.resolveShare(body.url || '', { account: acc });
    return sendJson(res, 200, { ok: true, data: r });
  }

  /* 日志 */
  if (p === '/api/logs') {
    const limit = Number(q.get('limit') || 200);
    return sendJson(res, 200, { ok: true, data: queryLogs(limit) });
  }

  /* 打开数据目录 */
  if (p === '/api/open-data-dir' && req.method === 'POST') {
    const dir = path.resolve(config.dataDir);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const { spawn } = await import('node:child_process');
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref();
    } catch { /* ignore */ }
    return sendJson(res, 200, { ok: true, data: dir });
  }

  /* 出口 IP / 归属地（多源交叉校验，验证代理是否生效） */
  if (p === '/api/ip' && req.method === 'GET') {
    const r = await checkIp();
    return sendJson(res, 200, { ok: true, data: r });
  }

  if (p === '/api/open-downloads' && req.method === 'POST') {
    const dir = path.join(path.resolve(config.dataDir), 'downloads');
    fs.mkdirSync(dir, { recursive: true });
    try {
      const { spawn } = await import('node:child_process');
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref();
    } catch { /* ignore */ }
    return sendJson(res, 200, { ok: true, data: dir });
  }

  /* 单个作品直接下载（解析结果里点“下载”走这里） */
  if (p === '/api/download' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = (Array.isArray(body.aweme_ids) ? body.aweme_ids : [body.aweme_id]).filter(Boolean).map(String);
    const urls = Array.isArray(body.urls) ? body.urls : (body.url ? [body.url] : []);
    if (!ids.length && !urls.length) return sendJson(res, 400, { ok: false, error: '缺少作品 ID 或链接' });
    const accs = listAccounts();
    const acc = body.account_id ? getAccount(body.account_id) : (accs.find((a) => a.logged_in === 1) || accs[0] || null);
    const t = engine.enqueue('download', { aweme_ids: ids, urls }, acc?.id || null);
    return sendJson(res, 200, { ok: true, data: { task_id: t.id, count: ids.length + urls.length } });
  }

  return sendJson(res, 404, { ok: false, error: 'not found: ' + p });
}

/* ------------------------------ server ------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('access-control-allow-origin', '*');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (e) {
    logger.error('server', `${req.method} ${url.pathname} -> ${e.message}`);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: e.message });
    else res.end();
  }
});

function listen(port, attempt = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt < 20) {
      logger.warn('server', `端口 ${port} 被占用，尝试 ${port + 1}`);
      listen(port + 1, attempt + 1);
    } else {
      logger.error('server', `监听失败: ${e.message}`);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    logger.ok('server', `控制台已启动: ${url}`);
    logger.info('server', `数据目录: ${path.resolve(config.dataDir)}`);
    if (config.autoOpenConsole) openInBrowser(url);
  });
}

engine.start();
scheduler.start();
listen(Number(config.port) || 9527);

process.on('SIGINT', async () => {
  logger.warn('server', '正在退出…');
  scheduler.stop();
  liveManager.stopAll();
  await host.shutdown();
  process.exit(0);
});
process.on('uncaughtException', (e) => logger.error('server', '未捕获异常: ' + e.message));
process.on('unhandledRejection', (e) => logger.error('server', '未处理 Promise: ' + (e?.message || e)));
