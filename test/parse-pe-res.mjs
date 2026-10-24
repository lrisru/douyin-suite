/** 解析 PE 资源段，找对话框/菜单/字符串表/HTML */
import fs from 'node:fs';

const exe = process.argv[2] || 'C:\\Users\\Administrator\\Desktop\\抖音综合工具.exe';
const buf = fs.readFileSync(exe);

// DOS header -> PE header
const peOff = buf.readUInt32LE(0x3c);
if (buf.toString('ascii', peOff, peOff + 4) !== 'PE\0\0') { console.log('不是 PE 文件'); process.exit(1); }

const numSections = buf.readUInt16LE(peOff + 6);
const optSize = buf.readUInt16LE(peOff + 20);
const optOff = peOff + 24;
const magic = buf.readUInt16LE(optOff);
const is64 = magic === 0x20b;
const dataDirOff = optOff + (is64 ? 112 : 96);
const resRva = buf.readUInt32LE(dataDirOff + 2 * 8);
const resSize = buf.readUInt32LE(dataDirOff + 2 * 8 + 4);

console.log(`PE ${is64 ? '64' : '32'}位 | 段数 ${numSections} | 资源表 RVA 0x${resRva.toString(16)} 大小 ${resSize}`);

// 段表
const secOff = optOff + optSize;
const sections = [];
for (let i = 0; i < numSections; i++) {
  const o = secOff + i * 40;
  const name = buf.toString('ascii', o, o + 8).replace(/\0/g, '');
  const vsize = buf.readUInt32LE(o + 8);
  const vaddr = buf.readUInt32LE(o + 12);
  const rawSize = buf.readUInt32LE(o + 16);
  const rawPtr = buf.readUInt32LE(o + 20);
  sections.push({ name, vsize, vaddr, rawSize, rawPtr });
  const ratio = vsize ? (rawSize / vsize).toFixed(3) : '0';
  console.log(`  ${name.padEnd(10)} vaddr=0x${vaddr.toString(16).padStart(6, '0')} vsize=${String(vsize).padStart(9)} raw=${String(rawSize).padStart(9)} 压缩比=${ratio}`);
}

const rva2off = (rva) => {
  for (const s of sections) {
    if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawSize)) return s.rawPtr + (rva - s.vaddr);
  }
  return -1;
};

if (!resRva) { console.log('\n没有资源表'); process.exit(0); }
const resBase = rva2off(resRva);
if (resBase < 0) { console.log('\n资源表不在文件里'); process.exit(0); }

const TYPES = { 1: 'CURSOR', 2: 'BITMAP', 3: 'ICON', 4: 'MENU', 5: 'DIALOG', 6: 'STRING', 7: 'FONTDIR', 9: 'ACCEL', 10: 'RCDATA', 12: 'GROUP_CURSOR', 14: 'GROUP_ICON', 16: 'VERSION', 23: 'HTML', 24: 'MANIFEST' };

function walk(dirOff, depth, path, out) {
  const named = buf.readUInt16LE(dirOff + 12);
  const ids = buf.readUInt16LE(dirOff + 14);
  for (let i = 0; i < named + ids; i++) {
    const e = dirOff + 16 + i * 8;
    const nameId = buf.readUInt32LE(e);
    const off = buf.readUInt32LE(e + 4);
    const name = (nameId & 0x80000000) ? `@${(nameId & 0x7fffffff)}` : String(nameId);
    if (off & 0x80000000) {
      const sub = resBase + (off & 0x7fffffff);
      walk(sub, depth + 1, [...path, name], out);
    } else {
      const dataEntry = resBase + off;
      const dataRva = buf.readUInt32LE(dataEntry);
      const dataSize = buf.readUInt32LE(dataEntry + 4);
      out.push({ type: path[0], name: path[1], lang: path[2], rva: dataRva, size: dataSize, off: rva2off(dataRva) });
    }
  }
}

const entries = [];
walk(resBase, 0, [], entries);
console.log('\n资源条目:', entries.length);

const byType = {};
for (const e of entries) byType[e.type] = (byType[e.type] || 0) + 1;
for (const [t, n] of Object.entries(byType)) console.log(`  类型 ${t} (${TYPES[t] || '?'}): ${n} 个`);

// 提取可疑资源为文件
fs.mkdirSync('test/exe-res', { recursive: true });
let dumped = 0;
for (const e of entries) {
  if (e.off < 0 || !e.size) continue;
  const typeName = TYPES[e.type] || e.type;
  if (!['RCDATA', 'HTML', 'DIALOG', 'MENU', 'STRING', 'VERSION'].includes(typeName)) continue;
  if (e.size > 3 * 1024 * 1024) continue;
  const fn = `test/exe-res/${typeName}_${e.name}.bin`;
  fs.writeFileSync(fn, buf.subarray(e.off, e.off + e.size));
  dumped++;
  if (e.size > 200) console.log(`  ${fn}  ${e.size} bytes`);
}
console.log('\n已导出', dumped, '个资源到 test/exe-res/');
