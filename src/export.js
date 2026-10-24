import { crc32 } from './util.js';

/* --------------------------- 极简 XLSX 写入（ZIP store，无依赖） --------------------------- */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + data.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

function colName(i) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function toXlsx(columns, rows, sheetName = 'Sheet1') {
  const header = columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr"><is><t>${esc(c.label)}</t></is></c>`).join('');
  const body = rows.map((row, ri) => {
    const cells = columns.map((c, ci) => {
      const v = typeof c.get === 'function' ? c.get(row) : row[c.key];
      if (v == null || v === '') return '';
      const ref = `${colName(ci)}${ri + 2}`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 2}">${cells}</row>`;
  }).join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;

  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ];

  return zipStore(files);
}

/* --------------------------- 导出列定义 --------------------------- */

export const EXPORT_SCHEMAS = {
  items: {
    sheet: '作品',
    columns: [
      { key: 'keyword', label: '关键词' },
      { key: 'aweme_id', label: '作品ID' },
      { key: 'desc', label: '文案' },
      { key: 'author', label: '作者' },
      { key: 'author_sec_uid', label: '作者sec_uid' },
      { key: 'digg', label: '点赞' },
      { key: 'comment', label: '评论' },
      { key: 'collect', label: '收藏' },
      { key: 'share', label: '分享' },
      { key: 'url', label: '链接' },
      { key: 'collected_at', label: '采集时间', get: (r) => (r.collected_at ? new Date(r.collected_at).toLocaleString() : '') },
    ],
  },
  users: {
    sheet: '用户',
    columns: [
      { key: 'keyword', label: '关键词' },
      { key: 'nickname', label: '昵称' },
      { key: 'uid', label: 'UID' },
      { key: 'unique_id', label: '抖音号' },
      { key: 'sec_uid', label: 'sec_uid' },
      { key: 'follower_count', label: '粉丝' },
      { key: 'following_count', label: '关注' },
      { key: 'total_favorited', label: '获赞' },
      { key: 'signature', label: '简介' },
      { key: 'collected_at', label: '采集时间', get: (r) => (r.collected_at ? new Date(r.collected_at).toLocaleString() : '') },
    ],
  },
  comments: {
    sheet: '评论',
    columns: [
      { key: 'aweme_id', label: '作品ID' },
      { key: 'keyword', label: '关键词' },
      { key: 'text', label: '评论内容' },
      { key: 'user_name', label: '用户昵称' },
      { key: 'user_sec_uid', label: '用户sec_uid（私信填这个）' },
      { key: 'user_uid', label: '用户UID' },
      { key: 'user_douyin_id', label: '抖音号' },
      { key: 'user_gender', label: '性别', get: (r) => (r.user_gender === 1 ? '男' : r.user_gender === 2 ? '女' : '') },
      { key: 'user_city', label: '地区' },
      { key: 'user_signature', label: '简介' },
      { key: 'user_followers', label: '粉丝' },
      { key: 'user_following', label: '关注' },
      { key: 'digg', label: '点赞' },
      { key: 'create_time', label: '发布时间', get: (r) => (r.create_time ? new Date(r.create_time * 1000).toLocaleString() : '') },
      { key: 'collected_at', label: '采集时间', get: (r) => (r.collected_at ? new Date(r.collected_at).toLocaleString() : '') },
    ],
  },
  lives: {
    sheet: '直播',
    columns: [
      { key: 'web_rid', label: '房间号' },
      { key: 'room_id', label: 'room_id' },
      { key: 'title', label: '标题' },
      { key: 'anchor', label: '主播' },
      { key: 'online', label: '在线' },
      { key: 'url', label: '链接' },
      { key: 'collected_at', label: '采集时间', get: (r) => (r.collected_at ? new Date(r.collected_at).toLocaleString() : '') },
    ],
  },
  conversations: {
    sheet: '私信会话',
    columns: [
      { key: 'conversation_id', label: '会话ID' },
      { key: 'nickname', label: '对方昵称' },
      { key: 'sec_uid', label: 'sec_uid' },
      { key: 'uid', label: 'UID' },
      { key: 'unread', label: '未读' },
      { key: 'last_message', label: '最后一条' },
      { key: 'last_time', label: '最后时间', get: (r) => (r.last_time ? new Date(r.last_time * (r.last_time < 1e12 ? 1000 : 1)).toLocaleString() : '') },
      { key: 'collected_at', label: '采集时间', get: (r) => (r.collected_at ? new Date(r.collected_at).toLocaleString() : '') },
    ],
  },
};

export function toCsv(kind, rows) {
  const schema = EXPORT_SCHEMAS[kind];
  if (!schema) throw new Error('unknown export kind');
  const head = schema.columns.map((c) => `"${c.label}"`).join(',');
  const body = rows.map((row) => schema.columns.map((c) => {
    const v = typeof c.get === 'function' ? c.get(row) : row[c.key];
    return `"${String(v ?? '').replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
  return '\ufeff' + head + '\r\n' + body;
}
