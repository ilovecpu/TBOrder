# 💳 The Bap — Stripe Terminal 설정 가이드

## 전체 흐름
```
손님이 키오스크에서 주문
    ↓
결제 화면 (금액 표시)
    ↓
"Tap Card to Pay" 버튼 터치
    ↓
키오스크 → tb-server.js → Stripe API (PaymentIntent 생성)
    ↓
Stripe Terminal SDK → 카드 리더기에 금액 전송
    ↓
손님이 카드 탭
    ↓
결제 완료 → 주문이 주방으로 전송
```

## 1단계: Stripe 계정 생성

1. https://dashboard.stripe.com/register 접속
2. 사업자 정보 입력:
   - Business name: The Bap / Pick A Bap
   - Company number: 이미 가지고 있는 Company No.
   - VAT number: 이미 가지고 있는 VAT No.
   - Bank account: 정산 받을 UK 은행 계좌
3. 신원 확인 완료 (보통 1-2일)

## 2단계: Stripe Terminal 리더기 주문

Stripe Dashboard → Terminal → Readers → Order reader

추천 리더기:
- **BBPOS WisePOS E** — 터치스크린, WiFi 연결, £249
  - 키오스크 옆에 놓기 좋음
  - 손님이 직접 카드 탭/삽입
- **Stripe Reader S700** — 더 큰 화면, £349
  - 금액 표시 + PIN 입력 가능

리더기는 WiFi로 Stripe 서버에 연결됩니다.
키오스크 PC에 USB로 연결하는 게 아닙니다!

## 3단계: Location 등록

Stripe Dashboard → Terminal → Locations

각 지점별로 Location 생성:
- Pick A Bap Farnborough
- The Bap Swindon
- The Bap Reading
- The Bap Bristol
- The Bap Oxford

생성 후 Location ID 메모 (예: `tml_xxxx`)

## 4단계: API Key 확인

Stripe Dashboard → Developers → API Keys

필요한 키:
- **Secret Key**: `sk_live_...` (서버용, 절대 공개 금지!)
- **Publishable Key**: `pk_live_...` (프론트엔드용)

⚠️ 테스트할 때는 `sk_test_...` / `pk_test_...` 사용

## 5단계: 서버 설정

### 환경변수 설정

Mac/Linux:
```bash
export STRIPE_SECRET_KEY="sk_live_여기에키입력"
export STRIPE_LOCATION_ID="tml_여기에로케이션ID"
```

또는 시작 스크립트에 포함:
```bash
STRIPE_SECRET_KEY="sk_live_xxx" STRIPE_LOCATION_ID="tml_xxx" node tb-server.js
```

### 패키지 설치
```bash
cd ~/Documents/GitHub/TBOrder
npm install
```

### 서버 시작
```bash
node tb-server.js
```

서버 시작 시 `💳 Stripe: ✅ Active` 가 보이면 성공!

## 6단계: 리더기 등록

1. 리더기 전원 켜기 + WiFi 연결
2. Stripe Dashboard → Terminal → Readers 에서 리더기 확인
3. Location에 리더기 배정

## 7단계: 테스트

### 테스트 모드
1. `sk_test_...` 키로 서버 실행
2. Stripe에서 제공하는 시뮬레이터 또는 테스트 리더 사용
3. 키오스크에서 주문 → 결제 → 주방 확인

### 테스트 카드 번호
- 성공: 4242 4242 4242 4242
- 거절: 4000 0000 0000 0002

### 실제 결제 전환
`sk_live_...` 키로 변경하면 실제 결제 시작

## 수수료

| 항목 | 요금 |
|------|------|
| UK 카드 | 1.4% + 20p |
| EU 카드 | 2.5% + 20p |
| 기타 해외 | 3.25% + 20p |
| 리더기 | £249 (1회) |
| 월 요금 | 없음 |
| 정산 | 2-7 영업일 |

예시: £8.25 주문 → 수수료 £0.32 → 실수령 £7.93

## Stripe 없이 사용

STRIPE_SECRET_KEY를 설정하지 않으면:
- 키오스크는 **데모 모드**로 동작
- "Tap Card" 누르면 2초 후 자동 결제 완료 (시뮬레이션)
- "Pay at Counter" 버튼으로 카운터 결제 가능
- 주문은 정상적으로 주방으로 전송됨

→ 리더기 도착 전까지 이 모드로 사용 가능!

## 문제 해결

| 증상 | 해결 |
|------|------|
| `Stripe not configured` | 환경변수 STRIPE_SECRET_KEY 확인 |
| 리더 검색 안됨 | 리더기 WiFi 연결 확인, 같은 네트워크 아니어도 됨 (Stripe 클라우드 경유) |
| 결제 거절 | Stripe Dashboard → Payments 에서 상세 사유 확인 |
| 서버 시작 시 stripe 오류 | `npm install` 다시 실행 |
