/**
 * 采集管道：搜索/评论走"抓接口响应"，粉丝/关注走"页面内分页 fetch"，会话走 DOM 提取。
 * 用假 cdp 精确模拟各条路径的返回，验证解析与分页逻辑。
 */
import { DouyinService } from '../src/douyin.js';
import { loadConfig } from '../src/util.js';

const cfg = loadConfig(process.cwd());
cfg.task.scrollTimes = 1;

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

/* ---------- 1. 粉丝列表分页（min_time 游标） ---------- */
const pageUsers = (n, prefix) => Array.from({ length: n }, (_, i) => ({
  sec_uid: `MS4w${prefix}${i}`, uid: `${prefix}${i}`, nickname: `${prefix}-${i}`,
  unique_id: `uid_${prefix}${i}`, follower_count: i * 10, signature: 'x',
}));

let fanCalls = 0;
const fanCdp = {
  evaluate: async () => {
    fanCalls++;
    if (fanCalls === 1) return { status: 200, json: { followers: pageUsers(13, 'a'), has_more: true, min_time: 1000 } };
    if (fanCalls === 2) return { status: 200, json: { followers: pageUsers(16, 'b'), has_more: false, min_time: 500 } };
    return { status: 200, json: { followers: [], has_more: false } };
  },
};
const host1 = { page: async () => ({ cdp: fanCdp }), checkLogin: async () => ({ loggedIn: true }) };
const d1 = new DouyinService(host1, cfg);
const r1 = await d1.followers({ id: 1 }, { secUid: 'x', limit: 100 });
check('粉丝两页合并', r1.users.length === 29, `pages=${r1.pages} users=${r1.users.length}`);
check('粉丝字段完整', r1.users[0].nickname === 'a-0' && r1.users[0].unique_id === 'uid_a0', JSON.stringify(r1.users[0]));

/* ---------- 2. 关注列表字段是 followings ---------- */
const folCdp = {
  evaluate: async () => ({ status: 200, json: { followings: pageUsers(3, 'f'), has_more: false, min_time: 1 } }),
};
const host2 = { page: async () => ({ cdp: folCdp }), checkLogin: async () => ({ loggedIn: true }) };
const d2 = new DouyinService(host2, cfg);
const r2 = await d2.following({ id: 1 }, { secUid: 'x', limit: 100 });
check('关注列表读 followings 字段', r2.users.length === 3 && r2.users[0].nickname === 'f-0', JSON.stringify(r2.users.map((u) => u.nickname)));

/* ---------- 3. 接口返回空 / 报错 ---------- */
const emptyCdp = { evaluate: async () => ({ status: 200, json: { followers: [], has_more: false, status_code: 0 } }) };
const d3 = new DouyinService({ page: async () => ({ cdp: emptyCdp }), checkLogin: async () => ({ loggedIn: true }) }, cfg);
const r3 = await d3.followers({ id: 1 }, { secUid: 'x' });
check('空列表不报错', r3.users.length === 0 && r3.pages === 0);

const badCdp = { evaluate: async () => ({ status: 500, json: null, text: 'boom' }) };
const d4 = new DouyinService({ page: async () => ({ cdp: badCdp }), checkLogin: async () => ({ loggedIn: true }) }, cfg);
const r4 = await d4.followers({ id: 1 }, { secUid: 'x' });
check('接口失败记录原因', r4.users.length === 0 && /boom|HTTP/.test(r4.error), r4.error);

/* ---------- 4. 私信会话 DOM 提取 ---------- */
const convCdp = {
  evaluate: async () => ([
    { nickname: '杭州天一男士发型设计', nameRaw: '杭州天一', desc: '兄弟是想设计发型吗？', time: '周二', text: '杭州天一男士发型设计 周二 兄弟是想设计发型吗？' },
    { nickname: '客户A', desc: '这个怎么卖', time: '昨天', text: '客户A 昨天 这个怎么卖' },
    { nickname: '', desc: '', text: '' },
  ]),
};
const d5 = new DouyinService({ page: async () => ({ cdp: convCdp }), checkLogin: async () => ({ loggedIn: true }) }, cfg);
const r5 = await d5.conversations({ id: 1 }, { limit: 10 });
check('会话提取两条', r5.conversations.length === 2, JSON.stringify(r5.conversations.map((c) => c.nickname)));
check('会话昵称与最后消息', r5.conversations[0].nickname.includes('杭州天一') && r5.conversations[0].last_message === '兄弟是想设计发型吗？');
check('会话去重字段', r5.conversations[0].conversation_id.startsWith('dom:'));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
