/** 从 MENU / DIALOG / 自定义资源里提取可见文本 */
import fs from 'node:fs';
import path from 'node:path';

const dir = 'test/exe-res';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.bin'));

function utf16(b) {
  const out = [];
  let cur = [];
  for (let i = 0; i + 1 < b.length; i += 2) {
    const c = b[i] | (b[i + 1] << 8);
    const ok = (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x20 && c <= 0x7e) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef);
    if (ok) cur.push(String.fromCharCode(c));
    else { if (cur.length >= 2) out.push(cur.join('')); cur = []; }
  }
  if (cur.length >= 2) out.push(cur.join(''));
  return out;
}

function gbkish(b) {
  // 把连续的非零字节当 latin1/utf8 试
  const out = [];
  let cur = [];
  for (const c of b) {
    if (c >= 0x20 && c !== 0x7f) cur.push(c);
    else { if (cur.length >= 3) out.push(Buffer.from(cur).toString('utf8')); cur = []; }
  }
  if (cur.length >= 3) out.push(Buffer.from(cur).toString('utf8'));
  return out.filter((s) => /[\u4e00-\u9fff]/.test(s) || /^[A-Za-z][\w\s.,:;-]{3,}$/.test(s));
}

for (const f of files.sort()) {
  const b = fs.readFileSync(path.join(dir, f));
  const a = utf16(b);
  const c = gbkish(b);
  const all = [...new Set([...a, ...c])].filter((s) => s.trim().length >= 2);
  if (!all.length) continue;
  console.log(`\n=== ${f} (${b.length}B) ===`);
  for (const s of all.slice(0, 40)) console.log('  ', JSON.stringify(s).slice(0, 100));
}
