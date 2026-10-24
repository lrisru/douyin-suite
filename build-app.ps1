# 抖音综合工具 - 打包脚本
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\douyin-suite'
$dist = Join-Path $root 'dist'
$appName = '抖音综合工具'
$app = Join-Path $dist $appName

Write-Output "=== 清理 ==="
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $app | Out-Null

Write-Output "=== 复制 Node 运行时 ==="
Copy-Item 'D:\node.exe' (Join-Path $app 'node.exe')
$sz = [math]::Round((Get-Item (Join-Path $app 'node.exe')).Length / 1MB, 1)
Write-Output "  node.exe $sz MB"

Write-Output "=== 复制程序 ==="
foreach ($d in 'src', 'web', 'docs', 'tools') {
  Copy-Item (Join-Path $root $d) (Join-Path $app $d) -Recurse
  Write-Output "  $d/"
}
foreach ($f in 'package.json', 'README.md', 'config.json', '.gitignore') {
  if (Test-Path (Join-Path $root $f)) { Copy-Item (Join-Path $root $f) (Join-Path $app $f) }
}

Write-Output "=== 生成启动脚本 ==="

# 启动器：检查 Chrome，后台起服务，等端口就绪后开浏览器
$launcher = @'
@echo off
chcp 65001 >nul
title 抖音综合工具
cd /d "%~dp0"

echo.
echo   ============================================
echo      抖音综合工具  ·  便携版
echo   ============================================
echo.

if not exist "node.exe" (
  echo   [错误] 缺少 node.exe，请重新解压完整压缩包
  pause
  exit /b 1
)

rem 检查 Chrome
set CHROME=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set CHROME=1
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set CHROME=1
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set CHROME=1
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set CHROME=1
if not defined CHROME (
  echo   [提示] 没检测到 Chrome 或 Edge。
  echo          程序需要它们来驱动浏览器，请先安装：
  echo          https://www.google.com/chrome/
  echo.
  pause
)

echo   正在启动服务…
start "" /b "%~dp0node.exe" "src\server.js"

echo   等待就绪…
set /a n=0
:wait
timeout /t 1 /nobreak >nul
set /a n+=1
if %n% geq 20 goto ready
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://127.0.0.1:9527/api/stats' -UseBasicParsing -TimeoutSec 1)|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 goto wait

:ready
echo   已就绪，正在打开控制台…
start "" "http://127.0.0.1:9527/classic.html"
echo.
echo   控制台地址：http://127.0.0.1:9527/classic.html
echo   关闭本窗口即停止服务
echo.
pause
'@
Set-Content -Path (Join-Path $app '启动.bat') -Value $launcher -Encoding Default
Write-Output "  启动.bat"

Write-Output "=== 生成说明文件 ==="
$readme = @'
抖音综合工具 · 便携版
======================

【怎么用】

1. 双击「启动.bat」
2. 等它自动打开浏览器（约 5-10 秒）
3. 第一次用先去「账号」页登录抖音（扫码）
4. 然后就能采数据了

关闭那个黑色窗口 = 停止服务。

【环境要求】

- Windows 10/11
- 已安装 Chrome 或 Edge（用来驱动浏览器操作抖音）
- 不需要装 Node，包里自带

【数据在哪】

data\ 目录下：
  data\douyin.db      数据库（作品/评论/用户/直播）
  data\profiles\      各账号的浏览器配置（含登录状态）
  data\downloads\     下载的视频
  data\backups\       备份文件

想整个备份，复制 data 目录即可。

【常用地址】

主控制台    http://127.0.0.1:9527/classic.html
完整功能    http://127.0.0.1:9527/
说明书      docs\使用手册.md

【出问题】

1. 浏览器没弹出 → 手动打开 http://127.0.0.1:9527/classic.html
2. 提示端口占用 → 程序会自动换端口，看黑窗口里打印的实际地址
3. 采不到数据 → 检查账号是否掉线（「账号」页 → 重新登录）
4. 想彻底重置 → 删掉 data 目录，重新登录
'@
Set-Content -Path (Join-Path $app '使用说明.txt') -Value $readme -Encoding UTF8
Write-Output "  使用说明.txt"

Write-Output "=== 压缩 ==="
$zip = Join-Path $dist "$appName-便携版.zip"
Compress-Archive -Path $app -DestinationPath $zip -CompressionLevel Optimal
$zsz = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output "  $zip  ($zsz MB)"

Write-Output ""
Write-Output "=== 完成 ==="
Get-ChildItem $dist | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize | Out-String
