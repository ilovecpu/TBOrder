#!/bin/bash
echo ""
echo "  ========================================"
echo "    TBOrder Server Starting..."
echo "    The Bap Kiosk + POS System"
echo "  ========================================"
echo ""

# 스크립트가 있는 폴더로 이동
cd "$(dirname "$0")"

# Node.js 확인
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js가 설치되어 있지 않습니다!"
    echo ""
    echo "  https://nodejs.org 에서 Node.js를 설치해주세요."
    echo ""
    read -p "  Press Enter to close..."
    exit 1
fi

# 패키지 자동 설치
if [ ! -d "node_modules" ]; then
    echo "  패키지 설치 중..."
    npm install
    echo ""
fi

echo "  Node.js version: $(node --version)"
echo ""
echo "  서버를 시작합니다..."
echo "  종료하려면 Ctrl+C를 누르세요."
echo ""
node tb-server.js
