#!/usr/bin/env node
/**
 * 卡密生成器
 * 用法：
 *   node tools/genkey.mjs                       # 用本机机器码，365 天
 *   node tools/genkey.mjs --days=30             # 30 天
 *   node tools/genkey.mjs --machine=DYS-XXXX --days=90
 *   node tools/genkey.mjs --secret=xxxxx        # 指定密钥（需与 config.json 一致）
 */
import { machineCode, makeKey } from '../src/license.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=?(.*)$/);
  return m ? [m[1], m[2]] : [a, ''];
}));

const cfg = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')); } catch { return {}; }
})();

const secret = args.secret || cfg.license?.secret || 'change-me-please-32bytes-secret-key';
const machine = args.machine || machineCode();
const days = Number(args.days || 365);

const d = new Date(Date.now() + days * 86400000);
const p = (x) => String(x).padStart(2, '0');
const expiry = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

const key = makeKey(secret, machine, expiry);

console.log('机器码 :', machine);
console.log('到期日 :', expiry, `(${days} 天)`);
console.log('卡密   :', key);
console.log('');
console.log('把卡密填到控制台「设置 → 授权」里即可；记得先在 config.json 打开 license.enabled。');
