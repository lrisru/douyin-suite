/**
 * 零依赖 protobuf 解码 + 抖音 webcast 帧解析。
 * 只做「读」：varint / length-delimited / fixed32 / fixed64。
 */
import zlib from 'node:zlib';

export function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let p = pos;
  while (p < buf.length) {
    const b = buf[p++];
    result += (b & 0x7f) * Math.pow(2, shift);
    if ((b & 0x80) === 0) return { value: result, pos: p };
    shift += 7;
    if (shift > 63) break;
  }
  return { value: result, pos: p };
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * 解一层 protobuf，返回 { [fieldNo]: [{ wire, value }] }
 */
export function decode(buf) {
  const out = {};
  let p = 0;
  while (p < buf.length) {
    const k = readVarint(buf, p);
    p = k.pos;
    const key = k.value;
    if (key === 0) break;
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      const v = readVarint(buf, p);
      p = v.pos;
      (out[field] ||= []).push({ wire, value: v.value });
    } else if (wire === 2) {
      const len = readVarint(buf, p);
      p = len.pos;
      const end = p + len.value;
      if (end > buf.length) break;
      (out[field] ||= []).push({ wire, bytes: buf.subarray(p, end) });
      p = end;
    } else if (wire === 5) {
      if (p + 4 > buf.length) break;
      (out[field] ||= []).push({ wire, bytes: buf.subarray(p, p + 4) });
      p += 4;
    } else if (wire === 1) {
      if (p + 8 > buf.length) break;
      (out[field] ||= []).push({ wire, bytes: buf.subarray(p, p + 8) });
      p += 8;
    } else {
      break; // 不认识的 wire type，停止
    }
  }
  return out;
}

export const asNumber = (f, n) => f[n]?.[0]?.value ?? 0;
export const asBytes = (f, n) => f[n]?.[0]?.bytes ?? null;
export const asString = (f, n) => {
  const b = asBytes(f, n);
  return b ? utf8.decode(b) : '';
};
export const asList = (f, n) => f[n] || [];

/* ------------------------- 抖音 webcast 结构 ------------------------- */

const GZIP_MAGIC = [0x1f, 0x8b];

export function maybeGunzip(buf) {
  if (buf && buf.length > 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1]) {
    try { return zlib.gunzipSync(buf); } catch { return buf; }
  }
  return buf;
}

/**
 * PushFrame：field 8 = payload(bytes)，field 7 = payloadType
 */
export function parsePushFrame(buf) {
  const f = decode(buf);
  const payload = asBytes(f, 8);
  return {
    payloadType: asString(f, 7),
    payload: payload ? maybeGunzip(payload) : null,
    seqId: asNumber(f, 1),
    logId: asNumber(f, 2),
  };
}

/**
 * Response：field 1 = repeated Message{1:method, 2:payload}
 */
export function parseResponse(buf) {
  const f = decode(buf);
  const messages = [];
  for (const item of asList(f, 1)) {
    if (!item.bytes) continue;
    const m = decode(item.bytes);
    messages.push({
      method: asString(m, 1) || asString(m, 3) || '',
      payload: asBytes(m, 2) || null,
      msgId: asNumber(m, 3),
      msgType: asNumber(m, 4),
    });
  }
  return {
    messages,
    cursor: asString(f, 2),
    needAck: asNumber(f, 9) === 1,
    internalExt: asString(f, 5),
  };
}

function parseUser(buf) {
  if (!buf) return null;
  const f = decode(buf);
  const raw = asString(f, 3);
  // 真实数据里偶尔出现残缺 User（昵称只有一个符号），这里清洗掉
  const nickname = /^[\w\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2000-\u2fff._\-·+*]{1,40}$/.test(raw) && raw.length >= 1
    ? raw.trim()
    : '';
  const id = String(asNumber(f, 1) || '');
  if (!nickname && !id) return null;
  return {
    id,
    nickname,
    gender: asNumber(f, 4),
    signature: asString(f, 5),
    level: asNumber(f, 6),
    avatar: asString(f, 9),
  };
}

/**
 * 把一条 webcast 消息解成可读结构；认不出的类型返回 { type:'other', raw }
 * 字段号依据 2026-10 实际抓包校准（见 test/live-fields.json）：
 *   Chat    {2:User, 3:content}
 *   Member  {2:User, 3:memberCount}
 *   Like    {2:count, 3:total, 5:User}
 *   Social  {2:User}
 *   RoomStats {5/9: 在线人数}
 *   RoomUserSeq {3: 在线人数, 7: 累计观看}
 */
export function parseWebcastMessage(method, buf) {
  const base = { method, type: 'other', user: null, content: '', extra: {} };
  if (!buf) return base;
  const f = decode(buf);

  if (/ChatMessage/.test(method)) {
    const user = parseUser(asBytes(f, 2));
    return {
      ...base,
      type: 'chat',
      user,
      content: asString(f, 3),
      extra: { createTime: asNumber(f, 15) },
    };
  }
  if (/MemberMessage/.test(method)) {
    const user = parseUser(asBytes(f, 2));
    return {
      ...base,
      type: 'member',
      user,
      content: `${user.nickname || '有人'} 进入直播间`,
      extra: { memberCount: asNumber(f, 3) },
    };
  }
  if (/GiftMessage/.test(method)) {
    const user = parseUser(asBytes(f, 7)) || parseUser(asBytes(f, 2));
    const giftId = asNumber(f, 2);
    const repeat = asNumber(f, 5) || 1;
    const nameFromStrings = (extractStrings(buf)
      .filter((s) => /[\u4e00-\u9fff]/.test(s) && s !== user?.nickname && !/^Webcast/.test(s) && s.length <= 12)
      .sort((a, b) => a.length - b.length)[0] || '').slice(0, 20);
    return {
      ...base,
      type: 'gift',
      user,
      content: `${user?.nickname || '有人'} 送出 ${nameFromStrings || '礼物'} x${repeat}`,
      extra: { giftId, repeatCount: repeat, comboCount: asNumber(f, 6), giftName: nameFromStrings },
    };
  }
  if (/LikeMessage/.test(method)) {
    const user = parseUser(asBytes(f, 5)) || parseUser(asBytes(f, 2));
    const count = asNumber(f, 2) || 1;
    return {
      ...base,
      type: 'like',
      user,
      content: `${user?.nickname || '有人'} 点赞 x${count}`,
      extra: { count, total: asNumber(f, 3) },
    };
  }
  if (/SocialMessage/.test(method)) {
    const user = parseUser(asBytes(f, 2));
    return { ...base, type: 'social', user, content: `${user.nickname || '有人'} 关注了主播` };
  }
  if (/RoomUserSeqMessage/.test(method)) {
    const online = asNumber(f, 3);
    return {
      ...base,
      type: 'online',
      content: `在线 ${online}`,
      extra: { online, totalViewers: asNumber(f, 7) },
    };
  }
  if (/RoomStatsMessage/.test(method)) {
    const online = asNumber(f, 5) || asNumber(f, 9);
    const text = (extractStrings(buf).find((s) => /在线观众|看过/.test(s)) || '').slice(0, 30);
    return { ...base, type: 'online', content: text || `在线 ${online}`, extra: { online, text } };
  }
  if (/ControlMessage/.test(method)) {
    return { ...base, type: 'control', content: '直播状态变化' };
  }
  if (/RoomMessage|RoomRank|RanklistHour|GiftSort/.test(method)) {
    return { ...base, type: 'room', content: '直播间榜单/排序更新' };
  }
  return base;
}

/** 兜底：从任意二进制里抽可读中文/英文串 */
export function extractStrings(buf, minLen = 2) {
  if (!buf) return [];
  const out = [];
  let cur = [];
  for (const b of buf) {
    if (b >= 0x20 && b !== 0x7f) cur.push(b);
    else {
      if (cur.length >= minLen) {
        const s = utf8.decode(Uint8Array.from(cur));
        if (/[\u4e00-\u9fffA-Za-z0-9]/.test(s)) out.push(s);
      }
      cur = [];
    }
  }
  if (cur.length >= minLen) out.push(utf8.decode(Uint8Array.from(cur)));
  return out;
}

/** 编码（只做测试与 ack 用得到的 varint 场景） */
export function encodeVarint(n) {
  const bytes = [];
  let v = Number(n);
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v & 0x7f);
  return Buffer.from(bytes);
}

export function encodeField(no, wire, payload) {
  const key = encodeVarint(no * 8 + wire);
  if (wire === 2) {
    const b = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    return Buffer.concat([key, encodeVarint(b.length), b]);
  }
  return Buffer.concat([key, encodeVarint(payload)]);
}
