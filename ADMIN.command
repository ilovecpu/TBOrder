#!/bin/bash
# 🍚 The Bap Admin v1.2 — 더블클릭으로 실행!
cd "$(dirname "$0")"
# 기존 9000포트 종료
lsof -ti:9000 | xargs kill -9 2>/dev/null
# 프록시 서버 시작 (Google API CORS 우회)
python3 admin-server.py &
sleep 1
# 브라우저 열기
open "http://localhost:9000/TBMain_Kiosk.html?remote=true"
echo "✅ Admin 실행 중 — 이 창을 닫으면 종료됩니다"
echo "   Google API 프록시 활성화"
echo "   종료: Ctrl+C"
wait
