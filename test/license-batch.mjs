/** 验证批量卡密：20 个都通过、篡改失败、旧格式兼容、绑定卡密不串机 */
import fs from 'node:fs';
import { verifyKey, makeKey } from '../src/license.js';

const secret = JSON.parse(fs.readFileSync('config.json', 'utf8')).license.secret;
const lines = fs.readFileSync('keys.csv', 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[1]);
const OTHER_MACHINE = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

console.log(`共 ${lines.length} 个卡密`);
check('生成了 20 个', lines.length === 20);
check('互不相同', new Set(lines).size === 20);

// 通用卡密：任意机器都应通过
let okCount = 0;
for (const k of lines) {
  if (verifyKey(secret, OTHER_MACHINE, k).ok && verifyKey(secret, 'XXXX-YYYY', k).ok) okCount++;
}
check('20 个全部有效（任意机器）', okCount === 20, `${okCount}/20`);

// 篡改一位必须失败
const tampered = lines[0].slice(0, -1) + (lines[0].endsWith('A') ? 'B' : 'A');
check('篡改后失效', verifyKey(secret, OTHER_MACHINE, tampered).ok === false);

// 序号替换：拿 01 的签名配 02 的序号，应该失败
const forged = lines[0].replace('-01-', '-02-');
check('改序号伪造失败', verifyKey(secret, OTHER_MACHINE, forged).ok === false);

// 旧格式仍然兼容
const oldKey = makeKey(secret, 'MACHINE-A', '2027-12-31');
check('旧格式卡密仍可用', verifyKey(secret, 'MACHINE-A', oldKey).ok === true, oldKey);
check('旧格式换机失败', verifyKey(secret, 'MACHINE-B', oldKey).ok === false);

// 绑定卡密不应在别的机器生效
const bound = makeKey(secret, 'MACHINE-A', '2027-12-31', 1);
check('绑定卡密本机有效', verifyKey(secret, 'MACHINE-A', bound).ok === true);
check('绑定卡密换机无效', verifyKey(secret, 'MACHINE-B', bound).ok === false);

// 过期卡密
const expired = makeKey(secret, '*', '2020-01-01', 9);
check('过期卡密无效', verifyKey(secret, OTHER_MACHINE, expired).ok === false, expired);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
