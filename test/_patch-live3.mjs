import fs from 'node:fs';

const f = 'web/classic.js';
const lines = fs.readFileSync(f, 'utf8').split('\n');
const idx = lines.findIndex((l) => l.includes("esc(r.nickname"));
if (idx < 0) { console.log('找不到 users 分支'); process.exit(1); }

// 第 268 行（索引 267）是 "} else {"
const elseIdx = 267;
if (lines[elseIdx].trim() !== '} else {') {
  console.log('第 268 行不是 } else {，实际:', JSON.stringify(lines[elseIdx]));
  process.exit(1);
}

const livesLines = [
  "    } else if (kind === 'lives') {",
  "      html = list.slice(0, 500).map((r, i) => {",
  "        const rid = r.web_rid || r.room_id || '';",
  "        return `<tr>${cb(r)}<td>${i + 1}</td>",
  "          <td class=\"wrap\">${esc((r.title || '(无标题)').slice(0, 40))}</td>",
  "          <td>${esc(r.anchor || '')}</td>",
  "          <td>${esc(rid)}</td>",
  "          <td>${r.online || 0}</td>",
  "          <td>${esc(r.keyword || '')}</td>",
  "          <td>${esc(r.url || '')}</td></tr>`;",
  "      }).join('');",
  "    } else {",
];

lines.splice(elseIdx, 1, ...livesLines);
fs.writeFileSync(f, lines.join('\n'));
console.log('lives 分支已插入第', elseIdx + 1, '行');
