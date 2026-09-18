#!/bin/bash
set -e
cd /home/haodongtuo/.openclaw/workspace/projects/novabalancehealth

echo "=== 部署前检查 ==="
DELETED=$(git status --short | grep "^ D" | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "⚠️  警告：有 $DELETED 个文件被删除，部署前请确认："
  git status --short | grep "^ D"
  echo "如果这些删除是故意的，按 Enter 继续；否则 Ctrl+C 取消"
  read
fi
git status --short | grep -v "^??" | head -20

echo ""
echo "=== 开始部署 ==="
read TOKEN < /home/haodongtuo/.netlify_token
NETLIFY_AUTH_TOKEN="***" netlify deploy --prod --site=ea1af736-aaab-419e-b769-fa0b55b6f51a
