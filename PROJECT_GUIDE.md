# The Bap (더밥) POS/Kiosk System — 프로젝트 가이드
> 최종 업데이트: 2026-03-13
> 이 문서는 새 AI 또는 개발자가 프로젝트를 빠르게 이해하도록 작성됨

---

## 1. 프로젝트 개요

영국 한국식 테이크어웨이 체인 "The Bap"을 위한 POS/키오스크/주방 디스플레이 시스템.
개발자: DJ Kim (마이크로컨트롤러/자동화 엔지니어 출신, C/Pascal/Assembly 경험)

### 지점 (Branches)
| 코드 | 지점명 |
|------|--------|
| PAB | PAB |
| TBS | TBS |
| TBR | TBR |
| TBB | TBB |

---

## 2. 시스템 구조도

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Cloud                              │
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │ Google Apps Script│    │ TBMS Google Apps  │               │
│  │ (POS Menu API)   │    │ Script (지점관리) │               │
│  │ v2.2             │    │ (별도 프로젝트)   │               │
│  │                  │    │                   │               │
│  │ Google Sheets:   │    │ 지점/매장 정보    │               │
│  │ - Categories     │    │ 읽기 전용         │               │
│  │ - MenuItems      │    └──────────────────┘               │
│  │ - Sauces         │                                        │
│  │ - BranchPricing  │                                        │
│  │ - Orders         │                                        │
│  │ - DailySales     │                                        │
│  └────────┬─────────┘                                        │
└───────────┼──────────────────────────────────────────────────┘
            │ HTTP (GET/POST)
            │ 3분마다 자동 동기화
┌───────────┼──────────────────────────────────────────────────┐
│ Local     │  Server (Node.js)                                │
│ Network   ▼                                                  │
│  ┌──────────────────┐                                        │
│  │ tb-server.js     │ v2.1                                   │
│  │ Port: 5500       │                                        │
│  │                  │                                        │
│  │ - HTTP 서빙      │                                        │
│  │ - WebSocket      │◄──── 실시간 통신 ────┐                │
│  │ - menu.json 관리 │                       │                │
│  │ - Google 동기화   │                       │                │
│  │ - 프린터 연동     │                       │                │
│  └──┬───┬───┬───┬───┘                       │                │
│     │   │   │   │                           │                │
│     ▼   ▼   ▼   ▼                           │                │
│  ┌────┐┌────┐┌─────┐┌───────┐         ┌────┴────┐          │
│  │POS ││Kio-││Kitch││Custom-│         │ Admin   │          │
│  │    ││sk  ││en   ││er Disp│         │         │          │
│  │v2.9││v1.8││v1.2 ││lay    │         │ v3.7    │          │
│  └────┘└────┘└─────┘└───────┘         └─────────┘          │
│  TBPos TBOrder TBKit  TBCust          TBMain_Kiosk          │
│  .html _Kiosk  chen_  omerDi          .html                 │
│        .html   Kiosk  splay                                  │
│                .html  .html                                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 파일 목록 및 역할

### 핵심 소스 파일

| 파일명 | 버전 | 역할 |
|--------|------|------|
| `tb-server.js` | v2.1 | Node.js 로컬 서버. HTTP + WebSocket + Google 동기화 + 프린터 |
| `google-apps-script.js` | v2.2 | Google Apps Script 코드. Google Sheets CRUD + LockService |
| `TBMain_Kiosk.html` | v3.7 | Admin 관리자 페이지. 카테고리/메뉴/지점/설정 관리 |
| `TBPos.html` | v2.9 | POS 계산대 화면 |
| `TBOrder_Kiosk.html` | v1.8 | 고객용 키오스크 주문 화면 |
| `TBKitchen_Kiosk.html` | v1.2 | 주방 디스플레이 (주문 실시간 표시) |
| `TBCustomerDisplay.html` | - | 고객용 디스플레이 (주문 확인) |
| `tb-printer.js` | - | 프린터 드라이버 모듈 |
| `admin-server.py` | - | Python 관리 서버 (보조) |

### 설정/데이터 파일

| 파일명 | 역할 |
|--------|------|
| `data/menu.json` | 메뉴 데이터 (카테고리, 아이템, 소스, 가격 등) — 핵심 데이터 |
| `data/pos-settings.json` | POS 설정 |
| `data/printer-config.json` | 프린터 설정 |
| `data/drawer-log.json` | 금전함 로그 |
| `data/orders_YYYY-MM-DD.json` | 일별 주문 기록 |
| `data/register_YYYY-MM-DD.json` | 일별 레지스터 기록 |
| `data/end_sales_log.json` | END Sales 로그 |
| `CLAUDE.md` | AI 작업 지시사항 (버전 변경 시 반드시 알려줘야 함) |
| `package.json` | Node.js 의존성 |

### 기타

| 파일명 | 역할 |
|--------|------|
| `START_POS.bat` | Windows 서버 시작 배치파일 |
| `AUTORUN_SETUP.bat` | Windows 자동 시작 설정 |
| `TBLOGO.png` | 로고 이미지 |
| `BOYAK.png` | 보약 이미지 |

---

## 4. Google Apps Script URL (2개)

### POS Google API (메뉴/주문 데이터)
```
https://script.google.com/macros/s/AKfycbzoEItk-hU2BPDyj_Dy1Vwxzu-R7PQoZYVzwzVsdPuTJWYCykVIWdWTwG8nieWCwaUD7w/exec
```
- 사용 파일: tb-server.js, TBMain_Kiosk.html, TBPos.html, TBOrder_Kiosk.html, admin-server.py
- 역할: 메뉴 CRUD, 주문 저장, 일별 매출, 이미지 업로드

### TBMS API (지점 관리 — 별도 프로젝트, 변경 금지)
```
https://script.google.com/macros/s/AKfycbwaC6b6WTo4Gw_UpgbpbrVDj52ooG-qqcqPeR4Tgne_bWbzDomXw14SlD0q6QiszZw5/exec
```
- 사용 파일: tb-server.js, TBPos.html, google-apps-script.js
- 역할: 지점(Branch) 목록 읽기 전용

---

## 5. 데이터 흐름 (핵심 이해 사항)

### 메뉴 데이터 흐름
```
Admin (브라우저 localStorage)
  │
  ▼ autoSyncToServer() — POST /api/menu
  │
Server (menuCache + data/menu.json)
  │
  ├──▶ debouncedSyncMenuToGoogle() — 2.5초 디바운스 후 1회 POST
  │     └──▶ Google Apps Script → Google Sheets (LockService 직렬화)
  │
  ├──▶ broadcastMsg() — WebSocket으로 모든 클라이언트에 즉시 전달
  │     └──▶ Kiosk, POS, Kitchen 자동 갱신
  │
  └──◀ syncMenuFromGoogle() — 3분마다 GET, dirty flag 기반 병합
        └──◀ Google Sheets → Server → 클라이언트 브로드캐스트
```

### 카테고리 보이기/숨기기 필드

| 필드명 | 레벨 | 의미 |
|--------|------|------|
| `showInKiosk` | 카테고리 | 키오스크에 이 카테고리를 표시할지 (boolean) |
| `showInPos` | 카테고리 | POS에 이 카테고리를 표시할지 (boolean) |
| `showOnKiosk` | 아이템 | 키오스크에 이 메뉴 아이템을 표시할지 (boolean) |
| `showOnPos` | 아이템 | POS에 이 메뉴 아이템을 표시할지 (boolean) |
| `active` | 둘 다 | 활성/비활성 (boolean) |

### 카테고리 목록 (11개)
combe, k-food, kchicken, kbbq, bbm, soup, korean_chicken_box_(chicken_only), side, snack, drink, kis

---

## 6. 최근 해결한 주요 이슈들 (2026-03-12~13)

### 이슈 1: 카테고리/아이템 중복 — 근본 원인 해결

**원인**: `syncMenuToGoogle()`가 `await` 없이 fire-and-forget으로 호출됨 → 빠른 연속 편집 시 여러 개의 동시 POST → Google Sheets의 `writeSheet()`가 `sheet.clear()` + `appendRow()` 반복하는데 동시 실행이 인터리빙되어 중복 행 생성

**해결 (2단계)**:
1. **tb-server.js**: `debouncedSyncMenuToGoogle()` — 2.5초 디바운스 타이머 + `_googleSyncInProgress` 플래그로 동시 호출 방지
2. **google-apps-script.js**: `updateFullMenu()`에 `LockService.getScriptLock()` 추가 — 동시 요청도 순차 실행 보장

### 이슈 2: showInKiosk=false인데 키오스크에 표시됨 — 근본 원인 해결

**원인 3가지**:
1. `syncMenuFromGoogle` 병합 로직이 "서버 값 항상 우선" → 서버에 잘못된 `true`가 있으면 Google의 올바른 `false`가 영원히 적용 안됨
2. boolean 정규화 없음 — `showInKiosk`가 문자열 `"false"`, `"FALSE"`로 저장될 수 있음
3. 키오스크/POS 필터 `!== false` — 문자열 `"false"`는 boolean `false`와 다르므로 필터 통과

**해결**:
1. `_localMenuDirty` 플래그 도입 — Admin 편집 후 Google 미업로드 상태에서만 서버 우선, 아니면 Google 값 수용
2. `toBool()` 유틸리티 — `saveMenuData()`에서 모든 boolean 필드 강제 변환
3. `isShown()` / `_isShown()` 헬퍼 — Kiosk/POS에서 문자열 "false"도 올바르게 처리

### 이슈 3: CAT_HEADERS에 showInKiosk/showInPos 누락

**원인**: Google Apps Script의 `CAT_HEADERS` 배열에 showInKiosk/showInPos가 없어서 Google Sheets에 저장 안됨
**해결**: CAT_HEADERS에 추가, getCategories()에 boolean 파싱 추가

### 이슈 4: Google Sheets 동기화 주기

**변경**: 5분 → 3분 (`setInterval(syncMenuFromGoogle, 3 * 60 * 1000)`)
- Admin에서 직접 수정 시 WebSocket으로 즉시 반영 (1~2초)
- Google Sheets 직접 수정 시 최대 3분 대기

---

## 7. 핵심 코드 위치 (빠른 참조)

### tb-server.js (v2.1)
- `toBool()` boolean 정규화: ~line 90
- `saveMenuData()` 저장 + 정규화 + 중복제거: ~line 97
- `syncMenuFromGoogle()` Google→서버 동기화: ~line 149
- `_localMenuDirty` dirty flag: ~line 192
- `debouncedSyncMenuToGoogle()` 디바운스: ~line 195
- `syncMenuToGoogle()` 서버→Google 업로드: ~line 240
- 동기화 타이머 설정 (3분): ~line 332
- `GET /api/menu` 핸들러: ~line 1808
- `POST /api/menu` 핸들러 (updateAll): ~line 1814

### google-apps-script.js (v2.2)
- `doPost()` 라우터: ~line 88
- `updateFullMenu()` + LockService: ~line 305
- `CAT_HEADERS` (showInKiosk/showInPos 포함): ~line 319
- `writeSheet()`: ~line 660
- `getCategories()` boolean 파싱: ~line 220대
- `getItems()` boolean 파싱: ~line 260대

### TBMain_Kiosk.html (Admin v3.7)
- `buildMenuPayload()` 메뉴→서버 페이로드: ~line 3645
- `autoSyncToServer()` 자동 저장: ~line 3908
- `pullMenuFromServer()` 서버→Admin: ~line 3800대
- `saveCategory()` 카테고리 저장: ~line 2625
- 카테고리 showInKiosk 체크박스: `catShowInKiosk`

### TBOrder_Kiosk.html (Kiosk v1.8)
- `isShown()` boolean 헬퍼: ~line 2061
- `loadMenuFromAPI()` 메뉴 로드 + 필터: ~line 2055
- WebSocket `menu_update` 수신: ~line 2205

### TBPos.html (POS v2.9)
- `_isShown()` boolean 헬퍼: ~line 1353
- `getItemsForCategory()` 아이템 필터: ~line 1354
- `getActiveCategories()` 카테고리 필터: ~line 1367

---

## 8. 서버 실행 방법

```bash
# Node.js 서버 시작 (기본 포트 5500)
cd TBOrder
node tb-server.js

# 또는 Windows에서
START_POS.bat

# 환경변수로 Google API 설정 가능 (기본값은 코드에 내장)
GOOGLE_MENU_API=https://... node tb-server.js
```

접속:
- Admin: `http://localhost:5500/TBMain_Kiosk.html`
- POS: `http://localhost:5500/TBPos.html`
- Kiosk: `http://localhost:5500/TBOrder_Kiosk.html`
- Kitchen: `http://localhost:5500/TBKitchen_Kiosk.html`

---

## 9. Google Apps Script 배포 방법

1. Google Sheets 열기 → Extensions → Apps Script
2. `google-apps-script.js` 코드 전체 복사 → 붙여넣기
3. Deploy → New deployment → Web app
   - Execute as: Me
   - Who has access: Anyone
4. 배포 URL 복사 → 모든 파일의 GOOGLE_API URL 업데이트

---

## 10. 주의사항 (CLAUDE.md)

- **프로그램이 변경 될때 마다 버전 정보를 업데이트 하고 꼭 알려줘**
- 모든 설정은 반드시 서버 AND Google Sheets에 저장
- 서버는 Windows 또는 Mac에서 실행 가능
- TBMS URL은 별도 프로젝트 — 함부로 변경 금지
- END Sales + VAT + Daily Report 기능은 아직 미구현 (보류 중)

---

## 11. 미완료 작업 (TODO)

1. **END Sales + VAT + Daily Report** — 사용자가 "이 문제 모두 해결뒤에" 라고 함. 중복/visibility 이슈 해결 완료되었으므로 진행 가능
2. **기타 안정화** — 실제 운영 테스트 후 발견되는 이슈 대응
