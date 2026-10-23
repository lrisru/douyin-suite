#!/bin/bash
# 抖音综合工具 - macOS / Linux 启动脚本
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "没找到 node。请先安装 Node.js 20+："
  echo "  brew install node        # macOS"
  echo "  或到 https://nodejs.org 下载"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "当前 Node 版本 $(node -v)，需要 20 以上（node:sqlite 依赖）"
  exit 1
fi

echo "启动中… 浏览器会自动打开控制台"
node src/server.js
