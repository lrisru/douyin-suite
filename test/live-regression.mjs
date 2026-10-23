/**
 * 真实字段布局回归：按 2026-10 抓包结果构造消息，验证解析器。
 * 参考 test/live-fields.json / live-probe2.json
 */
import { encodeField, parseWebcastMessage } from '../src/protobuf.js';

const enc = (s) => Buffer.from(s, 'utf8');
const user = (name, id) => Buffer.concat([encodeField(1, 0, id), encodeField(3, 2, enc(name))]);

let pass = 0;
let fail = 0;
const check = (name, cond, got) => {
  if (cond) { pass++; console.log('PASS', name, got ?? ''); }
  else { fail++; console.log('FAIL', name, got ?? ''); }
};

// Chat：2=User, 3=content（真实内容是 [赞][爱心] 这类表情占位）
const chat = parseWebcastMessage('WebcastChatMessage', Buffer.concat([
  encodeField(2, 2, user('王金金', 2497702098115304)),
  encodeField(3, 2, enc('[赞][爱心][爱心]')),
  encodeField(15, 0, 1792658430),
]));
check('chat.user.nickname', chat.user?.nickname === '王金金', chat.user?.nickname);
check('chat.content', chat.content === '[赞][爱心][爱心]', chat.content);
check('chat.createTime', chat.extra.createTime === 1792658430);

// Member：2=User, 3=memberCount
const member = parseWebcastMessage('WebcastMemberMessage', Buffer.concat([
  encodeField(2, 2, user('名字不好取', 108255986358)),
  encodeField(3, 0, 4832),
]));
check('member.memberCount', member.extra.memberCount === 4832);
check('member.content', /进入直播间/.test(member.content), member.content);

// Like：2=count, 3=total, 5=User（校准后的布局）
const like = parseWebcastMessage('WebcastLikeMessage', Buffer.concat([
  encodeField(2, 0, 9),
  encodeField(3, 0, 175683),
  encodeField(5, 2, user('银河汇', 1539781918726763)),
]));
check('like.count', like.extra.count === 9, like.extra.count);
check('like.total', like.extra.total === 175683, like.extra.total);
check('like.user', like.user?.nickname === '银河汇', like.user?.nickname);

// Social：2=User
const social = parseWebcastMessage('WebcastSocialMessage', Buffer.concat([
  encodeField(2, 2, user('朱广杰', 99430091123)),
]));
check('social.user', social.user?.nickname === '朱广杰');

// RoomStats：5=在线
const stats = parseWebcastMessage('WebcastRoomStatsMessage', encodeField(5, 0, 4484));
check('roomstats.online', stats.extra.online === 4484, String(stats.extra.online));

// RoomUserSeq：3=在线, 7=累计
const seq = parseWebcastMessage('WebcastRoomUserSeqMessage', Buffer.concat([
  encodeField(3, 0, 4744), encodeField(7, 0, 135609),
]));
check('userseq.online', seq.extra.online === 4744);
check('userseq.totalViewers', seq.extra.totalViewers === 135609);

// Gift：未抓到真实样本，走兜底
const gift = parseWebcastMessage('WebcastGiftMessage', Buffer.concat([
  encodeField(2, 0, 8888), encodeField(5, 0, 3), encodeField(7, 2, user('大哥', 1003)),
]));
check('gift.user', gift.user?.nickname === '大哥');
check('gift.repeat', gift.extra.repeatCount === 3);

// 未知类型
const other = parseWebcastMessage('WebcastSomeNewThing', Buffer.concat([encodeField(1, 2, enc('hello'))]));
check('unknown -> other', other.type === 'other');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
