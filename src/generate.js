/**
 * 内容生成：按车型/预算/城市/场景，用模板拼话术
 * 原版的「内容生成」模块，这里是规则模板版（不依赖外部 AI，离线可用）
 */

const DM_TEMPLATES = [
  '看到您在问{车型}贴膜，{预算}这个预算能做好，您是在{城市}吗？我按您的车型给个准数',
  '您好，{车型}贴{品类}{预算}能安排，您想要亮面还是哑光？方便说下在哪个区',
  '{城市}的{车型}车主是吧？{预算}这个档位我这边能上{品类}，您是想整车还是主要部位',
  '{车型}{品类}{预算}，说实话这个预算够用的。您车是新车还是开了一段时间了？',
  '看到您问{品类}，{车型}这个尺寸{预算}能做，质保{质保}年。您什么时间方便到店看样',
];

const COMMENT_TEMPLATES = [
  '{车型}贴{品类}，{预算}能做好，看重什么？',
  '这个价位的{品类}，关键看胶水和质保，{预算}可以拿到不错的',
  '{预算}预算建议选{品类}，别贪便宜也别被坑，看你停车环境',
  '{车型}的话建议上{品类}，{预算}出头能做，看你需求',
];

const TITLE_TEMPLATES = [
  '{预算}预算给{车型}贴{品类}，我劝你先看这个',
  '{车型}贴{品类}踩过的坑，{城市}车主必看',
  '{预算}和{预算2}的{品类}差在哪？拆开给你看',
  '{品类}到底值不值？{车型}车主实测',
  '{城市}贴{品类}多少钱？报价单直接给你看',
];

const CATEGORIES = ['车衣', '隐形车衣', '改色膜', '太阳膜', '窗膜'];

function fill(tpl, vars) {
  // 占位符是中文，不能用 \w
  return tpl.replace(/\{([^}]+)\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : ''));
}

function pick(arr, n) {
  const out = [];
  const pool = [...arr];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

/**
 * @param {object} opts { type: 'dm'|'comment'|'title', car, budget, city, category, count }
 */
export function generate({ type = 'dm', car = '', budget = '', city = '', category = '', count = 3, warranty = 5 }) {
  const vars = {
    车型: car || '您的车',
    预算: budget || '这个预算',
    预算2: budget ? String(Number(String(budget).replace(/\D/g, '') || 0) + 2000) : '再加两千',
    城市: city || '本地',
    品类: category || CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)],
    质保: warranty,
  };

  const src = type === 'comment' ? COMMENT_TEMPLATES : type === 'title' ? TITLE_TEMPLATES : DM_TEMPLATES;
  const n = Math.max(1, Math.min(8, Number(count) || 3));
  const items = pick(src, n).map((t) => fill(t, vars));

  return {
    ok: true,
    type,
    vars,
    items,
    // 私信场景额外提示
    tip: type === 'dm'
      ? '抖音限制：对方回复或关注前只能发一条，一次就要说到点上'
      : type === 'comment'
        ? '评论区别放联系方式，会被折叠'
        : '标题里带车型和价格区间，点击率更高',
  };
}

/** 从评论内容里反推车型/预算，用于自动填参 */
export function parseIntent(text = '') {
  const out = {};
  const BRANDS = '理想|蔚来|小鹏|问界|零跑|哪吒|极氪|比亚迪|特斯拉|深蓝|埃安|岚图|智己|阿维塔|领克|红旗|长城|吉利|长安|奇瑞|哈弗|坦克|魏牌|星途|捷途|荣威|名爵|传祺|五菱|埃安|别克|福特|大众|丰田|本田|日产|马自达|沃尔沃|凯迪拉克|雷克萨斯|宝马|奔驰|奥迪';
  // 品牌 + 型号（字母数字）
  let m = text.match(new RegExp('(' + BRANDS + ')\\s*([A-Za-z]?\\d{1,3}[A-Za-z]?|L\\d|C\\d|H\\d|M\\d|G\\d|X\\d|PLUS|Pro|MAX)', 'i'));
  if (m) out.car = m[1] + m[2].replace(/\s+/g, '');
  if (!out.car) {
    m = text.match(/(蒙迪欧|卡罗拉|轩逸|朗逸|速腾|迈腾|帕萨特|雅阁|凯美瑞|天籁|思域|昂科威|探岳|途观|CR-?V|RAV4|汉兰达|奥德赛|model\s*[3yY])/i);
    if (m) out.car = m[0].replace(/\s+/g, '');
  }

  // 预算：先看 k/千，再看纯数字
  const kM = text.match(/(\d+(?:\.\d+)?)\s*[kK千]/);
  if (kM) out.budget = String(Math.round(Number(kM[1]) * 1000));
  else {
    const nM = text.match(/(?:预算|价格|大概|左右|报|要)?\s*(\d{3,6})(?!\d)/);
    if (nM) out.budget = nM[1];
  }

  const cityM = text.match(/(杭州|宁波|温州|绍兴|嘉兴|金华|台州|湖州|衢州|丽水|舟山|上海|苏州|南京|合肥|广州|深圳|北京|成都|重庆|武汉|西安|长沙|郑州|济南|青岛|天津|沈阳|大连|厦门|福州|南昌|昆明|贵阳|南宁|海口|太原|石家庄|哈尔滨|长春|兰州|银川|西宁|乌鲁木齐|拉萨|呼和浩特)/);
  if (cityM) out.city = cityM[1];
  if (/车衣|隐形车衣/.test(text)) out.category = '隐形车衣';
  else if (/改色/.test(text)) out.category = '改色膜';
  else if (/太阳膜|窗膜|隔热/.test(text)) out.category = '太阳膜';
  return out;
}