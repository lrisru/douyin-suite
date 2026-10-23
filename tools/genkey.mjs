#!/usr/bin/env node
/**
 * 卡密生成器
 *
 * 用法：
 *   node tools/genkey.mjs                       # 本机绑定，365 天
 *   node tools/genkey.mjs --days=30             # 30 天
 *   node tools/genkey.mjs --count=20            # 一次生成 20 个（带序号，互不相同）
 *   node tools/genkey.mjs --any --count=20      # 通用卡密（任何机器都能用）
 *   node tools/genkey.mjs --machine=DYS-XXXX    # 指定机器码
 *   node tools/genkey.mjs --secret=xxxx         # 指定密钥（需与 config.json 一致）
 *   node tools/genkey.mjs --csv=keys.csv        # 同时输出 CSV 台账
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
const anyMode = args.any !== undefined;
const machine = anyMode ? '*' : (args.machine || machineCode());
const days = Number(args.days || 365);
const count = Math.max(1, Math.min(500, Number(args.count || 1)));

const d = new Date(Date.now() + days * 86400000);
const p = (x) => String(x).padStart(2, '0');
const expiry = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

const keys = [];
for (let i = 1; i <= count; i++) keys.push(makeKey(secret, machine, expiry, i));

console.log(`模式   : ${anyMode ? '通用（不绑机器）' : '绑定机器'}`);
if (!anyMode) console.log(`机器码 : ${machine}`);
console.log(`到期日 : ${expiry}（${days} 天）`);
console.log(`数量   : ${count}`);
console.log('');
for (const k of keys) console.log(k);

if (args.out) {
  const fp = path.resolve(args.out);
  fs.writeFileSync(fp, keys.join('\n') + '\n');
  console.log(`\n已写入: ${fp}`);
}

if (args.csv) {
  const fp = path.resolve(args.csv);
  const rows = keys.map((k, i) => `${i + 1},${k},${expiry},${anyMode ? '通用' : machine}`);
  fs.writeFileSync(fp, `序号,卡密,到期日,绑定\n${rows.join('\n')}\n`);
  console.log(`CSV 已写入: ${fp}`);
}

console.log('\n把卡密填到控制台「设置 → 授权」；记得先在 config.json 打开 license.enabled。');
