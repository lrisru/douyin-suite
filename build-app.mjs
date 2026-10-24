/** 打包便携版：node.exe + 源码 + 启动脚本 + 说明 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const dist = path.join(root, 'dist');
const APP = '抖音综合工具';
const app = path.join(dist, APP);

const log = (m) => console.log(m);

// 1. 清理
if (fs.existsSync(dist)) fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
log('=== 清理 ===');

// 2. node.exe
const nodeExe = process.execPath;
fs.copyFileSync(nodeExe, path.join(app, 'node.exe'));
log(`=== node.exe ${(fs.statSync(nodeExe).size / 1048576).toFixed(1)} MB ===`);

// 3. 复制目录
for (const d of ['src', 'web', 'docs', 'tools']) {
  fs.cpSync(path.join(root, d), path.join(app, d), { recursive: true });
  log(`  ${d}/`);
}
for (const f of ['package.json', 'README.md', 'config.json']) {
  if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(app, f));
}

// 4. 启动脚本（纯 ASCII，避免 cmd 编码问题）
const launcher = [
  '@echo off',
  'chcp 65001 >nul 2>&1',
  'title Douyin Suite',
  'cd /d "%~dp0"',
  'echo.',
  'echo   ============================================',
  'echo      Douyin Suite  /  抖音综合工具  便携版',
  'echo   ============================================',
  'echo.',
  '',
  'if not exist "node.exe" (',
  '  echo   [ERROR] node.exe missing, please re-extract the zip',
  '  pause',
  '  exit /b 1',
  ')',
  '',
  'set CHROME=',
  'if exist "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" set CHROME=1',
  'if exist "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" set CHROME=1',
  'if exist "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe" set CHROME=1',
  'if exist "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" set CHROME=1',
  'if not defined CHROME (',
  '  echo   [WARN] Chrome / Edge not found.',
  '  echo          Install Chrome first: https://www.google.com/chrome/',
  '  echo.',
  '  pause',
  ')',
  '',
  'echo   Starting server ...',
  'start "" /b "%~dp0node.exe" "src\\server.js"',
  '',
  'echo   Waiting for ready ...',
  'set /a n=0',
  ':wait',
  'timeout /t 1 /nobreak >nul',
  'set /a n+=1',
  'if %n% geq 25 goto ready',
  'powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri \'http://127.0.0.1:9527/api/stats\' -UseBasicParsing -TimeoutSec 1)|Out-Null;exit 0}catch{exit 1}" >nul 2>&1',
  'if errorlevel 1 goto wait',
  '',
  ':ready',
  'echo   Ready. Opening console ...',
  'start "" "http://127.0.0.1:9527/classic.html"',
  'echo.',
  'echo   Console : http://127.0.0.1:9527/classic.html',
  'echo   Close this window to stop the service.',
  'echo.',
  'pause',
].join('\r\n');
fs.writeFileSync(path.join(app, '启动.bat'), launcher, 'latin1');
log('  启动.bat');

// 5. 说明文件（UTF-8 带 BOM，记事本可正常显示）
const readme = `抖音综合工具 · 便携版
======================

【怎么用】

1. 双击「启动.bat」
2. 等它自动打开浏览器（约 5-10 秒）
3. 第一次用先去「账号」页登录抖音（手机扫码）
4. 然后就能采数据了

关闭那个黑色窗口 = 停止服务。

【环境要求】

- Windows 10 / 11
- 已安装 Chrome 或 Edge（用来驱动浏览器操作抖音）
- 不需要装 Node，包里自带

【数据在哪】

data 目录：
  data\\douyin.db       数据库（作品/评论/用户/直播）
  data\\profiles\\      各账号浏览器配置（含登录状态）
  data\\downloads\\     下载的视频
  data\\backups\\       备份文件

想整个备份，复制 data 目录即可。

【常用地址】

主控制台    http://127.0.0.1:9527/classic.html
完整功能    http://127.0.0.1:9527/
说明书      docs\\使用手册.md
功能对照    docs\\原版功能对照.md

【出问题】

1. 浏览器没弹出
   → 手动打开 http://127.0.0.1:9527/classic.html

2. 提示端口占用
   → 程序会自动换端口，看黑窗口打印的实际地址

3. 采不到数据
   → 检查账号是否掉线（「账号」页 → 重新登录）

4. 想彻底重置
   → 删掉 data 目录，重新登录

5. 杀毒软件报警
   → 因为程序会启动 Chrome 并注入脚本，属正常行为，加白名单即可
`;
fs.writeFileSync(path.join(app, '使用说明.txt'), '\ufeff' + readme, 'utf8');
log('  使用说明.txt');

// 6. 压缩
const zip = path.join(dist, `${APP}-便携版.zip`);
try {
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${app}' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`], { stdio: 'pipe' });
  log(`=== 压缩 ===\n  ${zip}  (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
} catch (e) {
  log('压缩失败：' + (e.message || e));
}

// 7. 清单
log('\n=== 完成 ===');
const walk = (dir, depth = 0) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (depth < 1) { log('  '.repeat(depth + 1) + name + '/'); walk(p, depth + 1); }
    } else if (depth < 1) {
      log('  '.repeat(depth + 1) + `${name}  ${(st.size / 1024).toFixed(0)} KB`);
    }
  }
};
walk(app);
const total = execFileSync('powershell', ['-NoProfile', '-Command',
  `(Get-ChildItem -Path '${app}' -Recurse -File | Measure-Object Length -Sum).Sum`]).toString().trim();
log(`\n解压后大小: ${(Number(total) / 1048576).toFixed(1)} MB`);
