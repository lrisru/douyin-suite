import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export const events = new EventEmitter();
events.setMaxListeners(500);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const nowMs = () => Date.now();
export const nowIso = () => new Date().toISOString();

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

export function truncate(s, n = 200) {
  if (s == null) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function log(level, scope, msg, extra) {
  const item = { ts: nowMs(), level, scope, msg: typeof msg === 'string' ? msg : JSON.stringify(msg), extra: extra || null };
  const line = `[${fmtTime(item.ts)}] [${level}] [${scope}] ${item.msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  events.emit('log', item);
  return item;
}

export const logger = {
  info: (scope, msg, extra) => log('info', scope, msg, extra),
  warn: (scope, msg, extra) => log('warn', scope, msg, extra),
  error: (scope, msg, extra) => log('error', scope, msg, extra),
  ok: (scope, msg, extra) => log('ok', scope, msg, extra),
};

export function openInBrowser(url) {
  const { spawn } = require$('node:child_process');
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* 打开失败不影响服务 */ }
}

// ESM 里同步拿 require
import { createRequire } from 'node:module';
export const require$ = createRequire(import.meta.url);

export function resolveDataPath(config, ...parts) {
  const base = path.isAbsolute(config.dataDir) ? config.dataDir : path.resolve(process.cwd(), config.dataDir);
  return path.join(base, ...parts);
}

const DEFAULT_CONFIG = {
  port: 9527,
  chrome: '',
  headless: false,
  windowWidth: 1280,
  windowHeight: 860,
  dataDir: 'data',
  autoOpenConsole: true,
  license: { enabled: false, secret: 'change-me-please-32bytes-secret-key' },
  task: { concurrency: 1, minDelayMs: 1500, maxDelayMs: 4000, retry: 1, scrollTimes: 6, scrollDelayMs: 1200 },
  notify: { feishu: '', dingtalk: '', wechat: '' },
  proxy: { enabled: false, list: [] },
  sign: { server: '' },
};

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

export function loadConfig(root) {
  const file = path.join(root, 'config.json');
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      deepMerge(cfg, JSON.parse(text));
    }
  } catch (e) {
    console.warn('[config] 读取失败，使用默认配置: ' + e.message);
  }
  return cfg;
}

export function saveConfig(root, cfg) {
  const file = path.join(root, 'config.json');
  try {
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn('[config] 写入失败: ' + e.message);
    return false;
  }
}
