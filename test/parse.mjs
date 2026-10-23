/** 接口响应解析单测：搜索 / 粉丝 / 会话 / 评论，用真实字段结构构造 */
import { collectFromJson, parseAweme, parseUser } from '../src/douyin.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

const blank = () => ({ items: [], users: [], comments: [], lives: [], conversations: [], pages: 0 });

// 1. 搜索：general/search/single 的 data[]{type, aweme_info}
{
  const out = blank();
  collectFromJson({
    data: [{
      type: 1,
      aweme_info: {
        aweme_id: '7400000000000000001',
        desc: '麻辣香锅教程 #美食',
        author: { nickname: '食光小厨', uid: '1001', sec_uid: 'MS4wLjABaaa' },
        statistics: { digg_count: 1200, comment_count: 33, collect_count: 12, share_count: 5 },
        create_time: 1792000000,
      },
    }],
  }, { keyword: '美食' }, out);
  const it = out.items[0];
  check('搜索解析', out.items.length === 1 && it.aweme_id === '7400000000000000001', it?.desc);
  check('统计字段', it.digg === 1200 && it.comment === 33 && it.collect === 12 && it.share === 5);
  check('作者字段', it.author === '食光小厨' && it.author_sec_uid === 'MS4wLjABaaa');
  check('URL 生成', it.url.endsWith('/video/7400000000000000001'));
}

// 2. 粉丝列表：user_list
{
  const out = blank();
  collectFromJson({
    user_list: [
      { sec_uid: 'MS4wLjABu1', uid: '2001', nickname: '粉丝甲', unique_id: 'fans1', follower_count: 88, signature: '你好' },
      { sec_uid: 'MS4wLjABu2', uid: '2002', nickname: '粉丝乙', follower_count: 9 },
    ],
    has_more: 1,
  }, { keyword: 'followers:MS4w' }, out);
  check('粉丝解析', out.users.length === 2 && out.users[0].nickname === '粉丝甲');
  check('粉丝字段', out.users[0].follower_count === 88 && out.users[0].unique_id === 'fans1');
}

// 3. 会话列表：conversation_list
{
  const out = blank();
  collectFromJson({
    conversation_list: [
      {
        conversation_id: 'conv_123',
        participant: { nickname: '客户A', sec_uid: 'MS4wLjABc', uid: '3001' },
        unread_count: 3,
        last_message: { content: '这个怎么卖', created_at: 1792658000 },
      },
    ],
  }, {}, out);
  const c = out.conversations[0];
  check('会话解析', out.conversations.length === 1 && c.conversation_id === 'conv_123');
  check('会话字段', c.nickname === '客户A' && c.unread === 3 && c.last_message === '这个怎么卖');
}

// 4. 评论：comments[]
{
  const out = blank();
  collectFromJson({
    comments: [
      { cid: 'c1', aweme_id: '7400', text: '看着不错', user: { nickname: '路人', uid: '4001' }, digg_count: 7, create_time: 1792658000 },
    ],
    has_more: 0,
  }, { awemeId: '7400' }, out);
  const cm = out.comments[0];
  check('评论解析', out.comments.length === 1 && cm.cid === 'c1');
  check('评论字段', cm.text === '看着不错' && cm.user_name === '路人' && cm.digg === 7);
}

// 5. 直播：room
{
  const out = blank();
  collectFromJson({ room: { id_str: 'r1', title: '直播中', owner: { nickname: '主播', web_rid: '123' } } }, {}, out);
  check('直播解析', out.lives.length === 1 && out.lives[0].title === '直播中');
}

// 6. 单条解析函数
{
  const a = parseAweme({ aweme_id: '9', desc: 'd', author: { nickname: 'n' }, statistics: {} });
  check('parseAweme 缺字段兜底', a.digg === 0 && a.author === 'n');
  const u = parseUser({ sec_uid: 's', nickname: 'n', follower_count: '123' });
  check('parseUser 字符串数字', u.follower_count === 123);
  check('parseUser 无 sec_uid 返回 null', parseUser({ nickname: 'x' }) === null);
}

// 7. 脏数据不炸
{
  const out = blank();
  collectFromJson({ data: [null, {}, { aweme_info: null }] }, {}, out);
  check('脏数据忽略', out.items.length === 0);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
