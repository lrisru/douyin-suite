import fs from 'node:fs';

const f = 'web/classic.js';
let c = fs.readFileSync(f, 'utf8');
if (c.includes("kind === 'lives'")) { console.log('已存在，跳过'); process.exit(0); }

// 找到 users 分支的起始（它是最后一个 else）
const marker = "    } else {\n      html = list.slice(0, 500).map((r, i) => `<tr>${cb(r)}<td>${i + 1}</td>\n        <td>${esc(r.nickname || '')}</td>";
if (!c.includes(marker)) {
  console.log('找不到 users 分支，改用行号定位');
  const lines = c.split('\n');
  const idx = lines.findIndex((l) => l.includes("esc(r.nickname || '')"));
  console.log('nickname 行号:', idx + 1);
  // 往前找 "} else {"
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (lines[i].trim() === '} else {') { start = i; break; }
  }
  console.log('else 行号:', start + 1);
  if (start < 0) process.exit(1);

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
  lines.splice(start, 1, ...livesLines);
  c = lines.join('\n');
  fs.writeFileSync(f, c);
  console.log('已插入 lives 分支');
} else {
  console.log('marker 命中');
}
