/** protobuf 解析自检：用编码器构造 PushFrame/Response/ChatMessage 再解回来 */
import zlib from 'node:zlib';
import {
  decode, encodeField, encodeVarint, parsePushFrame, parseResponse, parseWebcastMessage, extractStrings,
} from '../src/protobuf.js';

const enc = (s) => Buffer.from(s, 'utf8');

// ChatMessage: 2=User{3:nickname}, 3=content
const user = Buffer.concat([encodeField(1, 0, 12345), encodeField(3, 2, enc('张三'))]);
const chat = Buffer.concat([encodeField(2, 2, user), encodeField(3, 2, enc('主播好棒！'))]);

// Message{1:method, 2:payload}
const msg = Buffer.concat([encodeField(1, 2, enc('WebcastChatMessage')), encodeField(2, 2, chat)]);

// Response{1: repeated Message}
const resp = encodeField(1, 2, msg);

// PushFrame{8: payload(gzip), 7: 'msg'}
const gz = zlib.gzipSync(resp);
const frame = Buffer.concat([encodeField(1, 0, 99), encodeField(7, 2, enc('msg')), encodeField(8, 2, gz)]);

const pf = parsePushFrame(frame);
console.log('payloadType:', pf.payloadType, 'payload bytes:', pf.payload?.length);

const r = parseResponse(pf.payload);
console.log('messages:', r.messages.length, 'method:', r.messages[0].method);

const m = parseWebcastMessage(r.messages[0].method, r.messages[0].payload);
console.log('parsed:', JSON.stringify(m));

const f = decode(r.messages[0].payload);
console.log('raw fields of chat:', Object.keys(f).join(','));
console.log('strings:', extractStrings(r.messages[0].payload).join(' | '));
console.log('varint roundtrip:', encodeVarint(300).toString('hex'));
