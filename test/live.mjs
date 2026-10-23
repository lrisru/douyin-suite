/** 直播弹幕解析 → 入库 全链路自检（不需要真实直播间） */
import zlib from 'node:zlib';
import { encodeField } from '../src/protobuf.js';
import { LiveStream } from '../src/live.js';
import { initDb, queryLiveMessages, getDb } from '../src/db.js';
import { loadConfig } from '../src/util.js';
import path from 'node:path';

const cfg = loadConfig(process.cwd());
initDb(cfg);

const enc = (s) => Buffer.from(s, 'utf8');
const user = (name, id) => Buffer.concat([encodeField(1, 0, id), encodeField(3, 2, enc(name))]);

function msg(method, payload) {
  return Buffer.concat([encodeField(1, 2, enc(method)), encodeField(2, 2, payload)]);
}

// ChatMessage
const chat = msg('WebcastChatMessage', Buffer.concat([encodeField(2, 2, user('测试观众', 1001)), encodeField(3, 2, enc('主播这波操作可以'))]));
// MemberMessage
const member = msg('WebcastMemberMessage', Buffer.concat([encodeField(2, 2, user('新来的', 1002)), encodeField(3, 0, 42)]));
// GiftMessage（字段按常见布局：2=giftId, 5=repeatCount, 7=user）
const gift = msg('WebcastGiftMessage', Buffer.concat([encodeField(2, 0, 8888), encodeField(5, 0, 3), encodeField(7, 2, user('大哥', 1003))]));

const response = Buffer.concat([encodeField(1, 2, chat), encodeField(1, 2, member), encodeField(1, 2, gift)]);
const frame = Buffer.concat([encodeField(1, 0, 1), encodeField(7, 2, enc('msg')), encodeField(8, 2, zlib.gzipSync(response))]);

const RID = 'selftest_' + Date.now();
const s = new LiveStream({ host: null, account: { id: 1 }, webRid: RID, onMessage: (m) => console.log('  event:', m.type, m.user_name, m.content) });
s.handleFrame({ response: { payloadData: frame.toString('base64') } });
s.flush();

const rows = queryLiveMessages({ web_rid: RID, limit: 10 });
console.log('入库条数:', rows.length);
for (const r of rows) console.log(' -', r.type, '|', r.user_name, '|', r.content);
console.log('统计:', JSON.stringify(s.stats));

getDb().prepare('DELETE FROM live_messages WHERE web_rid = ?').run(RID);
console.log(rows.length === 3 ? 'PASS' : 'FAIL');
process.exit(rows.length === 3 ? 0 : 1);
