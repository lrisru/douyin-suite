/** 从原版 exe 里提取字符串，找功能线索 */
import fs from 'node:fs';
import path from 'node:path';

const exe = process.argv[2] || 'C:\\Users\\Administrator\\Desktop\\抖音综合工具.exe';
if (!fs.existsSync(exe)) { console.log('找不到文件:', exe); process.exit(1); }

const buf = fs.readFileSync(exe);
console.log('文件大小:', (buf.length / 1048576).toFixed(1), 'MB');

// UTF-16LE 中文/英文串
function utf16Strings(b) {
  const out = [];
  let cur = [];
  for (let i = 0; i + 1 < b.length; i += 2) {
    const code = b[i] | (b[i + 1] << 8);
    const ok = (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x20 && code <= 0x7e) || code === 0x3001 || code === 0x3002 || (code >= 0xff00 && code <= 0xffef);
    if (ok) cur.push(String.fromCharCode(code));
    else {
      if (cur.length >= 3) out.push(cur.join(''));
      cur = [];
    }
  }
  if (cur.length >= 3) out.push(cur.join(''));
  return out;
}

// ASCII 串
function asciiStrings(b) {
  const out = [];
  let cur = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x20 && c <= 0x7e) cur += String.fromCharCode(c);
    else {
      if (cur.length >= 4) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

const u16 = utf16Strings(buf);
const asc = asciiStrings(buf);
console.log('UTF-16 串:', u16.length, '| ASCII 串:', asc.length);

// 只保留看起来像功能文案的中文
const cn = u16.filter((s) => /[\u4e00-\u9fff]/.test(s) && s.length <= 40);
const uniqCn = [...new Set(cn)];

const KEY = /采集|导出|发布|评论|私信|关注|点赞|收藏|粉丝|作品|用户|视频|直播|弹幕|任务|账号|代理|授权|卡密|下载|去水印|解析|定时|间隔|批量|搜索|关键词|监控|通知|备份|导入|清理|设置|统计|数据|列表|详情|主页|同城|推荐|话题|音乐|合集|收藏夹|转发|分享|举报|拉黑|删除|修改|签名|头像|昵称|性别|生日|地区|学校|认证|企业|蓝V|星图|橱窗|商品|小店|订单|销量|评价|追评|退货|客服|话术|模板|变量|随机|延时|并发|线程|频率|限速|风控|验证码|滑块|登录|扫码|切换|刷新|重启|停止|开始|暂停|继续|保存|加载|上传|删除|复制|粘贴/;
const featureWords = uniqCn.filter((s) => KEY.test(s) && !/^\s*$/.test(s));

fs.writeFileSync('test/exe-strings-cn.txt', uniqCn.join('\n'));
fs.writeFileSync('test/exe-strings-feature.txt', [...new Set(featureWords)].join('\n'));
fs.writeFileSync('test/exe-strings-ascii.txt', [...new Set(asc)].join('\n'));

console.log('中文串(去重):', uniqCn.length, '-> test/exe-strings-cn.txt');
console.log('功能相关词:', [...new Set(featureWords)].length, '-> test/exe-strings-feature.txt');

// 接口 / URL
const urls = [...new Set(asc.filter((s) => /^(https?:\/\/|\/aweme|\/webcast|\/api|ws:\/\/)/.test(s)))];
console.log('\n接口/URL 前 40:');
for (const u of urls.slice(0, 40)) console.log('  ', u.slice(0, 90));
fs.writeFileSync('test/exe-urls.txt', urls.join('\n'));
