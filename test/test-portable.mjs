/** 验证便携包：解压 -> 启动 -> 访问 -> 清理 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';

const root = process.cwd();
const zip = path.join(root, 'dist', '抖音综合工具-便携版.zip');
const tmp = path.join(os.tmpdir(), 'dy-portable-test');

let pass = 0;
let fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS', n, e); } else { fail++; console.log('FAIL', n, e); } };

if (!fs.existsSync(zip)) { console.log('找不到 zip'); process.exit(1); }

// 1. 解压到临时目录（模拟用户拿到包）
if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execFileSync('powershell', ['-NoProfile', '-Command',
  `Expand-Archive -Path '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: 'pipe' });
const app = path.join(tmp, '抖音综合工具');
check('解压后目录存在', fs.existsSync(app));
check('含 node.exe', fs.existsSync(path.join(app, 'node.exe')));
check('含 启动.bat', fs.existsSync(path.join(app, '启动.bat')));
check('含 使用说明.txt', fs.existsSync(path.join(app, '使用说明.txt')));
check('含 src/server.js', fs.existsSync(path.join(app, 'src', 'server.js')));
check('含 web/classic.html', fs.existsSync(path.join(app, 'web', 'classic.html')));
check('不含 data 目录（干净）', !fs.existsSync(path.join(app, 'data')));

// 2. 改端口避免冲突，直接用包里的 node.exe 启动
const cfgPath = path.join(app, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.port = 9599;
cfg.autoOpenConsole = false;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

const nodeExe = path.join(app, 'node.exe');
const proc = spawn(nodeExe, ['src/server.js'], { cwd: app, stdio: 'ignore', detached: false });
console.log('已启动，等待就绪…');

// 3. 等端口
let up = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const r = await fetch('http://127.0.0.1:9599/api/stats');
    if (r.ok) { up = true; break; }
  } catch { /* 还没起来 */ }
}
check('服务能启动', up);

if (up) {
  const s = await (await fetch('http://127.0.0.1:9599/api/stats')).json();
  check('stats 接口正常', s.ok === true, `作品 ${s.data?.items} 评论 ${s.data?.comments}`);

  const page = await fetch('http://127.0.0.1:9599/classic.html');
  const html = await page.text();
  check('classic.html 可访问', page.status === 200 && html.includes('抖音综合工具'));

  const js = await fetch('http://127.0.0.1:9599/classic.js');
  check('classic.js 可访问', js.status === 200);

  check('data 目录已自动创建', fs.existsSync(path.join(app, 'data')));
  check('sqlite 已初始化', fs.existsSync(path.join(app, 'data', 'douyin.db')));
}

// 4. 关掉
try { proc.kill(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 1500));
try {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*portable-test*' } | Stop-Process -Force`], { stdio: 'pipe' });
} catch { /* ignore */ }

console.log(`\n${pass} pass, ${fail} fail`);
console.log('临时目录保留在:', tmp, '（可手动删）');
process.exit(fail ? 1 : 0);
