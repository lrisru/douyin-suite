/** 从 exe 各段里找 HTML/JS/中文 UI 文案 */
import fs from 'node:fs';

const exe = process.argv[2] || 'C:\\Users\\Administrator\\Desktop\\抖音综合工具.exe';
const buf = fs.readFileSync(exe);

const peOff = buf.readUInt32LE(0x3c);
const numSections = buf.readUInt16LE(peOff + 6);
const optSize = buf.readUInt16LE(peOff + 20);
const optOff = peOff + 24;
const secOff = optOff + optSize;
const sections = [];
for (let i = 0; i < numSections; i++) {
  const o = secOff + i * 40;
  sections.push({
    name: buf.toString('ascii', o, o + 8).replace(/\0/g, ''),
    rawSize: buf.readUInt32LE(o + 16),
    rawPtr: buf.readUInt32LE(o + 20),
  });
}

// 1. 各段特征扫描
const sigs = {
  UPX: Buffer.from('UPX'),
  ZIP: Buffer.from('PK\x03\x04'),
  GZIP: Buffer.from([0x1f, 0x8b]),
  HTML: Buffer.from('<div'),
  HTML2: Buffer.from('<!DOCTYPE'),
  JS: Buffer.from('function('),
  JSON: Buffer.from('{"'),
  SQLITE: Buffer.from('SQLite format'),
  ENCRYPTED: Buffer.from('ENC'),
};
console.log('=== 段特征扫描 ===');
for (const s of sections) {
  const seg = buf.subarray(s.rawPtr, s.rawPtr + s.rawSize);
  const hits = [];
  for (const [k, sig] of Object.entries(sigs)) {
    const idx = seg.indexOf(sig);
    if (idx >= 0) hits.push(`${k}@${idx}`);
  }
  // 熵（判断是否加密）
  const freq = new Array(256).fill(0);
  const step = Math.max(1, Math.floor(seg.length / 65536));
  let n = 0;
  for (let i = 0; i < seg.length; i += step) { freq[seg[i]]++; n++; }
  let ent = 0;
  for (const f of freq) if (f) { const p = f / n; ent -= p * Math.log2(p); }
  console.log(`${s.name.padEnd(8)} ${String(s.rawSize).padStart(9)}B  熵=${ent.toFixed(2)}  ${hits.join(' ') || '-'}`);
}

// 2. 从大段里捞中文（可能有未加密的 UI 文案）
console.log('\n=== 大段里的中文串 ===');
const cnRe = /[\u4e00-\u9fff]{2,}/g;
const collected = new Set();
for (const s of sections) {
  if (s.rawSize < 100000) continue;
  const seg = buf.subarray(s.rawPtr, s.rawPtr + s.rawSize);
  // UTF-8 中文
  const txt = seg.toString('utf8');
  const m = txt.match(/[\u4e00-\u9fff][\u4e00-\u9fff\w，。、：；？！（）\-—…·]{1,30}/g) || [];
  for (const x of m) collected.add(x);
  // UTF-16LE 中文
  for (let i = 0; i + 1 < seg.length; i += 2) {
    const c = seg[i] | (seg[i + 1] << 8);
    if (c >= 0x4e00 && c <= 0x9fff) {
      let j = i;
      let str = '';
      while (j + 1 < seg.length) {
        const cc = seg[j] | (seg[j + 1] << 8);
        if ((cc >= 0x4e00 && cc <= 0x9fff) || (cc >= 0x20 && cc <= 0x7e)) { str += String.fromCharCode(cc); j += 2; }
        else break;
      }
      if (str.length >= 2) collected.add(str);
    }
  }
}
const list = [...collected].filter((s) => s.length >= 2 && s.length <= 30);
console.log('共', list.length, '条');
fs.writeFileSync('test/exe-cn-all.txt', list.join('\n'));

const FUNC = /采集|导出|发布|评论|私信|关注|点赞|收藏|粉丝|作品|用户|视频|直播|弹幕|任务|账号|代理|授权|卡密|下载|水印|解析|定时|间隔|批量|搜索|关键词|监控|通知|备份|导入|清理|设置|统计|数据|主页|同城|推荐|话题|音乐|合集|转发|分享|拉黑|删除|签名|头像|昵称|性别|生日|地区|学校|认证|企业|橱窗|商品|小店|订单|销量|评价|客服|话术|模板|变量|随机|延时|并发|线程|频率|限速|风控|验证码|滑块|登录|扫码|切换|刷新|重启|停止|开始|暂停|保存|加载|上传|复制|粘贴|清空|过滤|排序|翻页|批量|一键|自动|同步|恢复|迁移|备份/;
const funcs = list.filter((s) => FUNC.test(s));
console.log('\n=== 功能相关 ===');
const seen = new Set();
for (const f of funcs) {
  const k = f.slice(0, 6);
  if (seen.has(k)) continue;
  seen.add(k);
  console.log('  ', f);
}
fs.writeFileSync('test/exe-cn-func.txt', [...new Set(funcs)].join('\n'));
