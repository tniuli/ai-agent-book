#!/bin/bash

set -e

echo "🚀 AI Agent 电子书 - GitHub Pages 部署助手"
echo "=========================================="
echo ""

# 检查是否在正确的目录
if [ ! -f "package.json" ]; then
    echo "❌ 错误：请在 web 目录下运行此脚本"
    exit 1
fi

echo "请输入以下信息："
echo ""

# 获取 GitHub 用户名
read -p "GitHub 用户名: " GITHUB_USERNAME

# 获取仓库名称
read -p "仓库名称 (默认: ai-agent-book): " REPO_NAME
REPO_NAME=${REPO_NAME:-ai-agent-book}

# 配置 base 路径
echo ""
echo "⚙️  正在配置 VitePress base 路径..."
sed -i '' "s|base:.*|base: '/${REPO_NAME}/',|" .vitepress/config.ts
echo "✅ base 路径已设置为: /${REPO_NAME}/"

# 初始化 Git
echo ""
echo "📦 正在初始化 Git 仓库..."
if [ ! -d ".git" ]; then
    git init
    git add .
    git commit -m "🎉 初始化 AI Agent 电子书网页版"
else
    git add .
    git commit -m "📝 更新内容" || true
fi

# 添加远程仓库
REMOTE_URL="https://github.com/${GITHUB_USERNAME}/${REPO_NAME}.git"
if ! git remote get-url origin &> /dev/null; then
    git remote add origin "$REMOTE_URL"
    echo "✅ 远程仓库已添加: $REMOTE_URL"
else
    git remote set-url origin "$REMOTE_URL"
    echo "✅ 远程仓库已更新: $REMOTE_URL"
fi

echo ""
echo "✨ 准备完成！接下来请执行以下步骤："
echo ""
echo "1️⃣  推送到 GitHub:"
echo "   git push -u origin main"
echo ""
echo "2️⃣  在 GitHub 上启用 Pages:"
echo "   - 进入仓库 Settings → Pages"
echo "   - Source 选择 'GitHub Actions'"
echo "   - Save"
echo ""
echo "3️⃣  等待 Actions 构建完成（约 1-2 分钟）"
echo ""
echo "🌐 你的网站地址: https://${GITHUB_USERNAME}.github.io/${REPO_NAME}/"
echo ""
echo "💡 提示: 后续每次 push 到 main 分支都会自动部署"
