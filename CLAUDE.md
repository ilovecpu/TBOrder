프로그램이 변경 될때 마다 버젼 정보를 업데이트 하고 꼭 알려줘


각 Google Apps Script URL에 연결된 Google Sheet 정보를 정리해드릴게요:

---

**URL 1** — `AKfycbzoEItk-hU2B...` (GOOGLE_API)
- **용도**: POS 메뉴/주문 메인 API (v2.2)
- **사용 파일**: TBPos.html, TBOrder_Kiosk.html, admin-server.py
- **연결된 시트**: `SpreadsheetApp.getActiveSpreadsheet()` — 하나의 Google Sheet에 아래 탭들이 있음
  - Categories, MenuItems, Sauces, Allergens, Nutrition
  - BranchPricing, Orders, DailySales, EndSales

---

**URL 2** — `AKfycbyRtWRXXRJFR5...` (GOOGLE_MENU_API / GOOGLE_API)
- **용도**: Admin/Kiosk용 API (메뉴·카테고리 관리)
- **사용 파일**: tb-server.js, TBMain_Kiosk.html
- **연결된 시트**: URL 1과 **같은 Google Sheet** — 동일한 Apps Script 프로젝트의 다른 배포 버전이거나 같은 시트를 참조하는 별도 스크립트

---

**URL 3** — `AKfycbxRqSo00Q3YUzKk...` (TBMS_API)
- **용도**: The Bap Management System — 지점·직원 정보 조회 (Read-only)
- **사용 파일**: tb-server.js, TBPos.html, TBMain_Kiosk.html, google-apps-script.js
- **연결된 시트**: **별도의 TBMS 전용 Google Sheet** — 아래 탭 포함
  - Branches (지점 코드, 이름, 주소, 전화번호, active 상태)
  - Users (PIN, 역할 등 직원 데이터)
- **API Key**: `tBaP2026xKr!mGt9Qz`

---

정리하면, **URL 1과 2는 같은 메뉴/주문 Google Sheet**를 바라보고, **URL 3(TBMS)만 별도의 지점관리 Google Sheet**를 사용하는 구조입니다. 실제 Google Sheet 파일 이름이나 ID는 Apps Script 프로젝트 내부에서 `getActiveSpreadsheet()`로 바인딩되어 있어서 코드상에서는 직접 확인이 안 되고, Google Apps Script 편집기에서 확인할 수 있어요.