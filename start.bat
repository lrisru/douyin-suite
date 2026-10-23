@echo off
chcp 65001 >nul
title 抖音综合工具（自建版）
cd /d "%~dp0"
echo ============================================
echo   抖音综合工具（自建版）
echo   控制台: http://127.0.0.1:9527
echo ============================================
node src\server.js %*
echo.
echo 服务已退出，按任意键关闭窗口。
pause >nul
