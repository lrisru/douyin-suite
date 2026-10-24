/**
 * IP 查询：多源探测本机公网 IP 与归属地
 * 原版工具的 URL 列表里出现多个 IP 服务，用途是检测当前出口 IP 是否泄露/是否落在代理上
 */
import { logger } from './util.js';

const SOURCES = [
  { name: 'ipapi', url: 'https://ipapi.co/json/', pick: (j) => ({ ip: j.ip, loc: [j.country_name, j.region, j.city].filter(Boolean).join(' ') }) },
  { name: 'ipsb', url: 'https://api.ip.sb/ip', pick: (t) => ({ ip: String(t).trim(), loc: '' }) },
  { name: 'sohu', url: 'http://pv.sohu.com/cityjson?ie=utf-8', pick: (t) => {
    const m = String(t).match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    return { ip: j.cip, loc: j.cname || '' };
  } },
  { name: 'ipinfo', url: 'https://ipinfo.io/json', pick: (j) => ({ ip: j.ip, loc: [j.country, j.region, j.city].filter(Boolean).join(' ') }) },
];

async function one(src, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(src.url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json, text/plain, */*' },
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    const v = src.pick(body);
    if (!v || !v.ip) return null;
    return { source: src.name, ip: String(v.ip), location: String(v.loc || '') };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** 并发查多个源，返回最快成功的结果 + 全部结果 */
export async function checkIp() {
  const results = await Promise.all(SOURCES.map((s) => one(s)));
  const ok = results.filter(Boolean);
  // 排除内网/回环地址，优先带归属地的源
  const isPrivate = (ip) => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip);
  const valid = ok.filter((r) => r.ip && !isPrivate(r.ip));
  const pool = valid.length ? valid : ok;
  const first = pool.find((r) => r.location) || pool[0] || null;
  // 如果不同源返回不同 IP，说明有代理分流
  const uniq = [...new Set(ok.map((r) => r.ip))];
  return {
    ok: !!first,
    ip: first?.ip || '',
    location: first?.location || '',
    consistent: uniq.length <= 1,
    all: ok,
    failed: SOURCES.filter((s) => !ok.some((r) => r.source === s.name)).map((s) => s.name),
  };
}

/** 通过代理查（验证代理是否生效） */
export async function checkIpVia(proxy) {
  // Node 原生 fetch 不支持 http 代理，这里用最简 CONNECT 实现太复杂，
  // 改为提示用浏览器上下文查（见 douyin.js 的 ipViaBrowser）
  const base = await checkIp();
  return { ...base, note: `直连结果；要走代理请用浏览器内查询（proxy=${proxy || '未设置'}）` };
}
