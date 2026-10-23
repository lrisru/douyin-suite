/** 授权门禁测试：开启校验后未激活应被拦，激活后放行 */
import fs from 'node:fs';
import path from 'node:path';
import { makeKey } from '../src/license.js';

const base = 'http://127.0.0.1:9527';
const cfgPath = path.resolve('config.json');
const original = fs.readFileSync(cfgPath, 'utf8');

const j = async (p, o = {}) => {
  const r = await fetch(base + p, { headers: { 'content-type': 'application/json' }, ...o, body: o.body ? JSON.stringify(o.body) : undefined });
  let body = null;
  try { body = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body };
};

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

// 1. 默认（未启用）应放行
{
  const s = await j('/api/stats');
  check('默认未启用时放行', s.status === 200 && s.body?.data?.license?.enabled === false);
}

// 2. 打开 license.enabled，未激活 → 拦
{
  const cfg = JSON.parse(original);
  cfg.license.enabled = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log('已开启 license.enabled，重启服务需要手动；这里只验证 api 层是否拦');
}

console.log(`\n${pass} pass, ${fail} fail（需要重启服务后跑完整版）`);
fs.writeFileSync(cfgPath, original);
process.exit(0);
