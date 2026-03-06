#!/bin/bash
# ════════════════════════════════════════════════════════════
#  🍚 The Bap (더밥) — Mac 자동 설치/업데이트/실행 v1.1
#  GitHub에서 최신 코드 다운로드 → 설치 → 서버 실행
# ════════════════════════════════════════════════════════════

REPO_URL="https://github.com/ilovecpu/TBOrder.git"
INSTALL_DIR="$HOME/TBOrder"

clear
echo ""
echo "  ╔════════════════════════════════════════════╗"
echo "  ║  🍚 The Bap (더밥) — TBOrder Installer    ║"
echo "  ║  Mac Edition v1.1                          ║"
echo "  ╚════════════════════════════════════════════╝"
echo ""

# ─── 1) Node.js 확인 / 자동 설치 ───
if ! command -v node &> /dev/null; then
    echo "  ⚠️  Node.js가 설치되어 있지 않습니다."
    echo ""

    # Homebrew가 있으면 brew로 설치
    if command -v brew &> /dev/null; then
        echo "  📦 Homebrew로 Node.js 설치 중..."
        brew install node
    else
        echo "  Node.js를 설치해주세요:"
        echo "  👉 https://nodejs.org"
        echo ""
        echo "  설치 후 이 스크립트를 다시 실행하세요."
        echo ""
        read -p "  Press Enter to close..."
        exit 1
    fi
fi

echo "  ✅ Node.js $(node --version) 확인됨"
echo ""

# ─── 2) Git 확인 ───
if ! command -v git &> /dev/null; then
    echo "  ⚠️  Git이 설치되어 있지 않습니다."
    echo "  Xcode Command Line Tools 설치 중..."
    xcode-select --install 2>/dev/null
    echo ""
    echo "  설치 완료 후 이 스크립트를 다시 실행하세요."
    read -p "  Press Enter to close..."
    exit 1
fi

echo "  ✅ Git $(git --version | cut -d' ' -f3) 확인됨"
echo ""

# ─── 3) 다운로드 또는 업데이트 ───
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "  🔄 기존 설치 발견 — 최신 코드로 업데이트 중..."
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null
    echo "  ✅ 업데이트 완료!"
else
    echo "  📥 GitHub에서 다운로드 중..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    echo "  ✅ 다운로드 완료!"
fi

echo ""
cd "$INSTALL_DIR"

# ─── 4) 패키지 설치 ───
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo "  📦 패키지 설치 중..."
    npm install --production
    echo ""
fi

echo "  ✅ 패키지 준비 완료!"
echo ""

# ─── 5) 로컬 IP 표시 ───
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | head -1 | awk '{print $2}')
echo "  ════════════════════════════════════════════"
echo "  🚀 서버를 시작합니다!"
echo ""
echo "  📱 접속 주소:"
echo "     POS:      http://$LOCAL_IP:8080/pos"
echo "     Admin:    http://$LOCAL_IP:8080/admin"
echo "     주문:     http://$LOCAL_IP:8080/order"
echo "     주방:     http://$LOCAL_IP:8080/kitchen"
echo ""
echo "  💡 iPad/Android에서 위 주소로 접속하세요!"
echo "     (같은 Wi-Fi에 연결되어 있어야 합니다)"
echo ""
echo "  종료: Ctrl+C"
echo "  ════════════════════════════════════════════"
echo ""

node tb-server.js
