import { DatabaseSync } from 'node:sqlite';
const d = new DatabaseSync(':memory:');
const seg = (s) => String(s).replace(/[\u4e00-\u9fff]/g, (m) => ` ${m} `).replace(/\s+/g, ' ').trim();

d.exec(`CREATE VIRTUAL TABLE t USING fts5(x, tokenize='unicode61')`);
const ins = d.prepare('INSERT INTO t VALUES(?)');
for (const s of ['抖音美食教程分享', '麻辣香锅做法', 'cat video 猫咪日常']) ins.run(seg(s));

for (const q of ['美食', '香锅', '猫咪', 'cat']) {
  const phrase = `"${seg(q)}"`;
  const rows = d.prepare('SELECT x FROM t WHERE t MATCH ?').all(phrase);
  console.log(q, '->', rows.length, rows.map((r) => r.x.replace(/ /g, '')).join(' | '));
}

// 前缀 / 通配
console.log('prefix:', d.prepare('SELECT x FROM t WHERE t MATCH ?').all(`"${seg('美')}"`).length);
