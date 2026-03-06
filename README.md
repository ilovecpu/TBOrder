# 🍚 The Bap (더밥) — TBOrder Kiosk & POS System

> Multi-branch Korean takeaway ordering system with Kiosk, Kitchen Display, POS, and Admin panel.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/ilovecpu/TBOrder.git
cd TBOrder

# 2. Install dependencies
npm install

# 3. Run server
node tb-server.js

# 4. Open browser
# http://localhost:8080        → Launcher
# http://localhost:8080/order   → Customer Kiosk
# http://localhost:8080/kitchen → Kitchen Display
# http://localhost:8080/pos     → POS System
# http://localhost:8080/admin   → Admin Panel
```

## System Overview

| URL | File | Purpose | Device |
|-----|------|---------|--------|
| `/order` | TBOrder_Kiosk.html | Customer self-ordering kiosk | Tablet / Touchscreen |
| `/kitchen` | TBKitchen_Kiosk.html | Kitchen order display | Tablet (landscape) |
| `/pos` | TBPos.html | Point of Sale — payments, cash register, reports | Tablet / Desktop |
| `/admin` | TBMain_Kiosk.html | Admin — menu, branches, orders management | Desktop |
| `/mobile` | mobile.html | Mobile customer ordering | Phone |
| `/` | index.html | Launcher with all URLs | Any |

## Architecture

```
┌──────────────┐     WebSocket      ┌──────────────┐
│ Order Kiosk  │ ──────────────────→ │              │
│ (Customer)   │                     │              │
└──────────────┘                     │              │
                                     │  tb-server   │
┌──────────────┐     WebSocket      │   (Node.js)  │     ┌──────────┐
│   POS        │ ←─────────────────→ │              │ ←──→│  data/   │
│ (Staff)      │                     │  Port 8080   │     │  (JSON)  │
└──────────────┘                     │              │     └──────────┘
                                     │              │
┌──────────────┐     WebSocket      │              │
│   Kitchen    │ ←────────────────── │              │
│  Display     │                     └──────────────┘
└──────────────┘
```

All devices on the same WiFi network connect to `http://[SERVER-IP]:8080/[route]`.

## Features

### Order Kiosk (`/order`)
- Responsive design: small tablets to 20" screens
- Fullscreen kiosk mode
- Bilingual menu (English + Korean)
- Sauce & topping selection
- Customer name input
- Eat In / Take Away selection
- Bottom cart bar for minimal scrolling
- Stripe Terminal card payment integration

### POS System (`/pos`)
- Staff login with branch selection + PIN
- Direct order entry from menu
- Receive kiosk/mobile orders in real-time
- Cash payment with change calculator (quick buttons: £5/£10/£20/£50)
- Card payment processing
- Percentage discount application
- Cash register management (open/close with float)
- Daily sales reports (revenue, payment breakdown, top items, VAT)
- Receipt printing (80mm thermal printer)
- Responsive: tablet to desktop

### Kitchen Display (`/kitchen`)
- Real-time order queue via WebSocket
- Order status management (pending → preparing → done)
- Auto-filters completed orders

### Admin Panel (`/admin`)
- Branch management (PAB, TBS, TBR, TBB)
- Menu item CRUD
- Sauce management
- Order monitoring & management
- Daily data export

## Branches

| Code | Name | Korean |
|------|------|--------|
| PAB | PAB Kitchen | 팝 키친 |
| TBS | The Bap Swindon | 더밥 스윈던 |
| TBR | The Bap Reading | 더밥 레딩 |
| TBB | The Bap Bristol | 더밥 브리스톨 |

## Server API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server status, connected clients count |
| `/api/orders` | GET | Today's orders (or `?date=YYYY-MM-DD`) |
| `/api/orders/dates` | GET | Available order dates |
| `/api/ip` | GET | Server IP and WebSocket URL |
| `/api/stripe/connection-token` | POST | Stripe Terminal connection token |
| `/api/stripe/create-payment-intent` | POST | Create payment intent |
| `/api/stripe/payment-status/:id` | GET | Check payment status |
| `/api/stripe/status` | GET | Stripe configuration status |

## WebSocket Messages

| Type | Direction | Description |
|------|-----------|-------------|
| `register` | Client → Server | Register client type (order/kitchen/pos/admin) |
| `new_order` | Client ↔ Server | New order created, broadcast to kitchen/pos/admin |
| `order_status` | Client ↔ Server | Status change, broadcast to all |
| `menu_update` | Client ↔ Server | Menu data update broadcast |
| `delete_order` | Client → Server | Delete single order |
| `clear_orders` | Client → Server | Delete all orders |

## Data Storage

Orders are saved to `data/orders_YYYY-MM-DD.json` (auto-created). This folder is git-ignored.

## Stripe Terminal (Optional)

```bash
# Set environment variables before starting server
export STRIPE_SECRET_KEY=sk_live_...
export STRIPE_LOCATION_ID=tml_...
node tb-server.js
```

See `STRIPE_SETUP.md` for detailed integration guide.

## Requirements

- Node.js 14+
- npm
- Modern browser (Chrome 80+, Safari 12+, Firefox 75+, Edge 80+)
- Same WiFi network for multi-device setup

## Project Structure

```
TBOrder/
├── tb-server.js          # Node.js server (HTTP + WebSocket)
├── package.json          # Dependencies (ws, stripe)
├── index.html            # Launcher page
├── TBOrder_Kiosk.html    # Customer ordering kiosk
├── TBKitchen_Kiosk.html  # Kitchen display
├── TBPos.html            # POS system
├── TBMain_Kiosk.html     # Admin panel
├── mobile.html           # Mobile ordering
├── qr-generator.html     # QR code generator for mobile URL
├── test.html             # Connection diagnostic tool
├── TBLOGO.png            # Company logo
├── BOYAK.png             # Sub-logo (밥이보약)
├── google-apps-script.js # Google Sheets integration script
├── DB_Design.md          # Database schema design
├── STRIPE_SETUP.md       # Stripe Terminal setup guide
├── data/                 # Runtime order data (git-ignored)
└── node_modules/         # Dependencies (git-ignored)
```

---

**The Bap 더밥** — 밥이보약 · K-Food on the Bap

Version: 5.0 | 2026-03-06
