import http from 'node:http';
import { logger } from './util.js';
import { listProxies, updateProxy, pickProxy } from './db.js';

export function parseProxy(url) {
  try {
    const u = new URL(url.includes('://') ? url : `http://${url}`);
    return {
      protocol: u.protocol.replace(':', ''),
      host: u.hostname,
      port: Number(u.port || 80),
      auth: u.username ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : '',
    };
  } catch {
    return null;
  }
}

export function testProxy(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const p = parseProxy(url);
    if (!p) return resolve({ ok: false, error: '代理地址格式不对' });
    if (p.protocol.startsWith('socks')) {
      return resolve({ ok: false, error: 'socks 代理请在浏览器里直接用（本项只测 http）' });
    }
    const started = Date.now();
    const req = http.request({
      host: p.host,
      port: p.port,
      method: 'GET',
      path: 'http://api.ipify.org?format=json',
      headers: { Host: 'api.ipify.org', ...(p.auth ? { 'Proxy-Authorization': `Basic ${Buffer.from(p.auth).toString('base64')}` } : {}) },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let ip = '';
        try { ip = JSON.parse(data).ip || ''; } catch { ip = data.trim().slice(0, 60); }
        resolve({ ok: res.statusCode === 200 && !!ip, latency: Date.now() - started, exitIp: ip, status: res.statusCode });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout', latency: Date.now() - started }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message, latency: Date.now() - started }));
    req.end();
  });
}

export async function checkProxy(id, url) {
  const r = await testProxy(url);
  updateProxy(id, {
    status: r.ok ? 'ok' : 'bad',
    latency: r.latency || 0,
    exit_ip: r.exitIp || '',
    checked_at: Date.now(),
  });
  logger.info('proxy', `代理 ${url} -> ${r.ok ? 'OK ' + r.latency + 'ms ' + r.exitIp : '失败 ' + (r.error || '')}`);
  return r;
}

export async function checkAll() {
  const list = listProxies();
  const results = [];
  for (const p of list) results.push(await checkProxy(p.id, p.url));
  return results;
}

export function bestProxy() {
  const p = pickProxy();
  return p?.url || '';
}
