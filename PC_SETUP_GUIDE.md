# The Bap — PC 서버 세팅 가이드

## 순서 요약

Mac에서 → USB/네트워크로 파일 복사 → PC에서 설치 → 자동시작 등록

---

## STEP 1: Mac에서 PC로 파일 옮기기

### 옮겨야 할 파일 (TBOrder 폴더 전체)

```
TBOrder/
├── tb-server.js          ← 메인 서버
├── package.json          ← Node.js 패키지 정보
├── TBPos.html            ← POS 화면
├── TBOrder_Kiosk.html    ← 주문 키오스크
├── TBKitchen_Kiosk.html  ← 주방 디스플레이
├── TBMain_Kiosk.html     ← 메인 키오스크
├── google-apps-script.js ← Google Sheets 코드 (참고용)
├── data/                 ← 주문/레지스터 데이터 (자동 생성됨)
│   └── menu.json         ← 메뉴 데이터
├── INSTALL_WIN.bat       ← 원클릭 설치
├── START_SERVER.bat      ← 수동 서버 시작
├── AUTO_START_POS.bat    ← 자동시작 (서버+POS)
├── SETUP_AUTOSTART.bat   ← 자동시작 Windows 등록
├── BOYAK.png             ← 로고
└── TBLOGO.png            ← 로고
```

> ⚠️ `node_modules/` 폴더는 안 옮겨도 됩니다. PC에서 자동 설치됩니다.

### 옮기는 방법 (택 1)

- **USB**: TBOrder 폴더를 USB에 복사 → PC에 `C:\Users\{사용자}\TBOrder\` 에 붙여넣기
- **네트워크 공유**: Mac Finder → Go → Connect to Server → PC 공유폴더
- **GitHub**: Mac에서 push → PC에서 `INSTALL_WIN.bat` 실행 (자동 clone)

---

## STEP 2: PC에서 설치

### 방법 A: GitHub에서 자동 설치 (추천)

1. PC에 **Node.js** 설치: https://nodejs.org (LTS 버전)
2. PC에 **Git** 설치: https://git-scm.com/download/win
3. `INSTALL_WIN.bat` 더블클릭 → 자동으로 다운로드 + 서버 시작

### 방법 B: USB로 수동 복사

1. PC에 **Node.js** 설치: https://nodejs.org (LTS 버전)
2. USB에서 TBOrder 폴더를 `C:\Users\{사용자}\TBOrder\` 에 복사
3. `START_SERVER.bat` 더블클릭 → 자동으로 npm install + 서버 시작

---

## STEP 3: 서버 테스트

서버가 시작되면 콘솔에 이렇게 표시됩니다:

```
🍚 The Bap (더밥) — TBOrder Server v1.3
📡 HTTP server listening on port 8080
🌐 WebSocket server ready
```

브라우저에서 확인:
- POS: http://localhost:8080/pos
- 키오스크: http://localhost:8080/order
- 주방: http://localhost:8080/kitchen

---

## STEP 4: PC 켤 때 자동 시작 등록

`SETUP_AUTOSTART.bat` 더블클릭

이것만 하면 끝! PC를 켜면 자동으로:
1. TBOrder 서버가 (최소화 상태로) 시작
2. Chrome이 전체화면(키오스크 모드)으로 POS 실행

### 자동시작 해제하려면

`Win + R` → `shell:startup` 입력 → `TheBap_POS.lnk` 삭제

---

## 네트워크 접속 (다른 기기에서)

같은 Wi-Fi에서 PC의 IP로 접속:

1. PC에서 IP 확인: `Win + R` → `cmd` → `ipconfig` → IPv4 주소 확인
2. 예: PC IP가 `192.168.1.100` 이면
   - iPad POS: `http://192.168.1.100:8080/pos`
   - 키오스크 태블릿: `http://192.168.1.100:8080/order`
   - 주방 태블릿: `http://192.168.1.100:8080/kitchen`

---

## 방화벽 설정 (다른 기기 접속 안 될 때)

Windows 방화벽에서 포트 8080 열기:

1. 제어판 → Windows Defender 방화벽 → 고급 설정
2. 인바운드 규칙 → 새 규칙
3. 포트 → TCP → 8080 → 연결 허용 → 이름: "TBOrder Server"

---

## 문제 해결

| 문제 | 해결 |
|------|------|
| "Node.js not found" | https://nodejs.org 에서 설치 |
| 서버 시작 안됨 | `START_SERVER.bat` 로 수동 시작해서 에러 확인 |
| 다른 기기에서 접속 안됨 | 방화벽 포트 8080 확인, 같은 Wi-Fi인지 확인 |
| Chrome 안 열림 | Chrome 설치 경로 확인 (AUTO_START_POS.bat 수정) |
| 데이터 안 보임 | `data/` 폴더 권한 확인 |
