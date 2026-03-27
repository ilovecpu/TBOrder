#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  The Bap — TBOrder VPS Setup Script
#  Node.js 서버 + nginx 리버스 프록시 + systemd 자동 시작
#
#  사용법: bash setup_tborder_vps.sh
#  서버: Ubuntu/Debian VPS (root 권한)
# ═══════════════════════════════════════════════════════════

set -e

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
TBORDER_DIR="/var/www/tborder"
TBORDER_PORT=8080
REPO_URL="https://github.com/ilovecpu/TBOrder.git"

echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   🍚 The Bap — TBOrder VPS Setup         ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""

# ─── 1. Node.js 설치 (없으면) ───
echo "  [1/6] Node.js 확인..."
if ! command -v node &>/dev/null; then
    echo "  → Node.js 설치 중..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "  ✅ Node.js $(node -v) 설치 완료"
else
    echo "  ✅ Node.js $(node -v) 이미 설치됨"
fi

# ─── 2. Git clone / 업데이트 ───
echo "  [2/6] TBOrder 소스 가져오기..."
if [ -d "$TBORDER_DIR/.git" ]; then
    echo "  → 기존 소스 업데이트..."
    cd "$TBORDER_DIR"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
else
    echo "  → Git clone..."
    rm -rf "$TBORDER_DIR"
    git clone "$REPO_URL" "$TBORDER_DIR"
fi
cd "$TBORDER_DIR"

# ─── 3. npm 패키지 설치 ───
echo "  [3/6] npm 패키지 설치..."
if [ -f "package.json" ]; then
    npm install --production 2>/dev/null || true
    echo "  ✅ npm 패키지 설치 완료"
fi

# data 디렉토리 생성
mkdir -p "$TBORDER_DIR/data"
chown -R www-data:www-data "$TBORDER_DIR"

# ─── 4. systemd 서비스 생성 (자동 시작 + 자동 재시작) ───
echo "  [4/6] systemd 서비스 설정..."
cat > /etc/systemd/system/tborder.service << 'SYSTEMD'
[Unit]
Description=The Bap TBOrder Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/tborder
ExecStart=/usr/bin/node tb-server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=8080

# 로그
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tborder

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable tborder
systemctl restart tborder
echo "  ✅ tborder 서비스 시작됨 (자동 재시작 활성화)"

# ─── 5. nginx 리버스 프록시 설정 ───
echo "  [5/6] nginx 설정..."

# 기존 thebap 사이트 설정에 tborder location 추가
NGINX_CONF="/etc/nginx/sites-available/thebap"

# 기존 설정 백업
if [ -f "$NGINX_CONF" ]; then
    cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%Y%m%d%H%M%S)"
fi

# tborder location이 이미 있는지 확인
if grep -q "location /tborder" "$NGINX_CONF" 2>/dev/null; then
    echo "  → /tborder location 이미 존재 — 업데이트..."
    # 기존 tborder 블록 제거 후 재삽입
    sed -i '/# TBOrder reverse proxy/,/# END TBOrder/d' "$NGINX_CONF"
fi

# nginx 설정에서 마지막 } 앞에 tborder location 삽입
# 기존 server 블록의 닫는 } 바로 앞에 추가
sed -i '/^}/i \
\n    # TBOrder reverse proxy (Node.js + WebSocket)\
    location /tborder/ {\
        proxy_pass http://127.0.0.1:8080/;\
        proxy_http_version 1.1;\
        proxy_set_header Upgrade $http_upgrade;\
        proxy_set_header Connection "upgrade";\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
        proxy_read_timeout 86400;\
        proxy_send_timeout 86400;\
    }\
    # END TBOrder' "$NGINX_CONF"

# nginx 설정 테스트
nginx -t
if [ $? -eq 0 ]; then
    systemctl reload nginx
    echo "  ✅ nginx 설정 완료 (리버스 프록시: /tborder/ → :8080)"
else
    echo "  ❌ nginx 설정 오류! 수동 확인 필요:"
    echo "     nano $NGINX_CONF"
    echo "  백업 파일에서 복원 가능: ${NGINX_CONF}.bak.*"
fi

# ─── 6. 업데이트 스크립트 생성 ───
echo "  [6/6] 업데이트 스크립트 생성..."
cat > /root/update_tborder.sh << 'UPDATE'
#!/bin/bash
echo "Updating TBOrder..."
cd /var/www/tborder
git pull origin main 2>/dev/null || git pull origin master 2>/dev/null
npm install --production 2>/dev/null || true
chown -R www-data:www-data /var/www/tborder
systemctl restart tborder
echo "Done! Updated at $(date)"
echo "Status:"
systemctl status tborder --no-pager -l | head -5
UPDATE
chmod +x /root/update_tborder.sh

# ─── 완료 ───
echo ""
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║         ✅  Setup Complete!                   ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo ""
echo "  서버 구조:"
echo "    /var/www/"
echo "    ├── default/       → 랜딩 페이지"
echo "    ├── tbms/          → TBMS 관리시스템"
echo "    └── tborder/       → TBOrder (Node.js)"
echo ""
echo "  접속 주소:"
echo "    POS:      http://${SERVER_IP}/tborder/TBPos.html"
echo "    Kiosk:    http://${SERVER_IP}/tborder/TBOrder_Kiosk.html"
echo "    Kitchen:  http://${SERVER_IP}/tborder/TBKitchen_Kiosk.html"
echo "    Admin:    http://${SERVER_IP}/tborder/TBMain_Kiosk.html"
echo ""
echo "  관리 명령어:"
echo "    상태 확인:   systemctl status tborder"
echo "    로그 보기:   journalctl -u tborder -f"
echo "    재시작:      systemctl restart tborder"
echo "    업데이트:    bash /root/update_tborder.sh"
echo ""
