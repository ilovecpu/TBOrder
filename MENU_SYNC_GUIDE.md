# The Bap (더밥) — Menu Sync Guide

## Architecture Overview

```
Google Sheets (Master DB)
       ↕ (Apps Script API)
tb-server.js (Local Cache: data/menu.json)
       ↕ (REST API: /api/menu)
   ┌───┴───┐───────┐──────────┐
 Kiosk    POS    Kitchen    Admin
```

All clients (Kiosk, POS, Kitchen, Admin) load menu from the **server REST API** (`/api/menu`).
When Admin changes menu, it **auto-syncs** to the server and **broadcasts** via WebSocket to all clients.

## Quick Start (No Google Sheets)

Menu sync works **without Google Sheets**. The server stores menu in `data/menu.json`.

1. Start server: `node tb-server.js`
2. Open Admin: `http://localhost:8080/admin`
3. Edit menu in Admin → changes sync to server automatically
4. All clients (Kiosk, POS) will load updated menu on next page load
5. Use **Sync > Broadcast Menu Update** button to push changes in real-time

## Google Sheets Integration (Optional)

### Step 1: Create Google Sheet

Create a Google Spreadsheet with these tabs:
- **Categories** — columns: id, nameEn, nameKr, icon, color, sortOrder, active
- **MenuItems** — columns: id, catId, nameEn, nameKr, desc, price, image, dietary, isCombo, comboCount, hasTopping, toppingCount, btnColor, active, sortOrder
- **Sauces** — columns: id, nameEn, nameKr, price, spiceLevel
- **Orders** — columns: orderNumber, branchCode, date, items, total, status, paymentMethod

### Step 2: Deploy Google Apps Script

1. In your Google Sheet → Extensions → Apps Script
2. Copy contents of `google-apps-script.js` into the editor
3. Run `initializeSheets()` function once (this creates sheet headers)
4. Deploy → New deployment → Web app
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the deployment URL (e.g., `https://script.google.com/macros/s/XXXXX/exec`)

### Step 3: Configure Server

Set the environment variable before starting the server:

**Windows:**
```bat
set GOOGLE_MENU_API=https://script.google.com/macros/s/XXXXX/exec
node tb-server.js
```

**Mac/Linux:**
```bash
GOOGLE_MENU_API=https://script.google.com/macros/s/XXXXX/exec node tb-server.js
```

The server will:
- Auto-sync from Google Sheets on startup
- Sync every 5 minutes
- Store local cache in `data/menu.json` for offline use

### Step 4: Use Admin Sync Panel

In Admin → Sync section:
- **Push to Server**: Push localStorage menu to server
- **Pull from Server**: Download server menu to admin
- **Broadcast Menu Update**: Push + broadcast to all live clients
- **Push to Google**: Push server menu → Google Sheets
- **Pull from Google**: Download from Google Sheets → server → admin

## REST API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/menu` | GET | Get full menu (categories, items, sauces) |
| `/api/menu` | POST | Update menu (see actions below) |
| `/api/menu/sync` | POST | Trigger Google Sheets sync |

### POST /api/menu Actions

```json
{ "action": "updateAll", "menuData": { "categories": [...], "items": [...], "sauces": [...] } }
{ "action": "addItem", "item": { ... } }
{ "action": "updateItem", "item": { "id": "M001", ... } }
{ "action": "deleteItem", "itemId": "M001" }
{ "action": "updateCategories", "categories": [...] }
{ "action": "syncToGoogle" }
{ "action": "syncFromGoogle" }
```

## Menu Data Format (data/menu.json)

```json
{
  "version": 1,
  "lastUpdated": "2026-03-06T12:00:00.000Z",
  "categories": [
    { "id": "kfood", "nameEn": "K-Food", "nameKr": "K-푸드", "icon": "🍚", "color": "#D97706", "sortOrder": 1, "active": true }
  ],
  "items": [
    { "id": "M001", "catId": "kfood", "nameEn": "Combo Bap", "nameKr": "콤보밥", "desc": "...", "price": 9.55, "image": "", "dietary": [], "isCombo": true, "comboCount": 2, "btnColor": "#C0392B", "active": true, "sortOrder": 1 }
  ],
  "sauces": [
    { "id": "S001", "nameEn": "No Sauce", "nameKr": "소스 없음", "price": 0, "spiceLevel": 0 }
  ],
  "branchPricing": {
    "TBS": { "M001": 10.00 }
  }
}
```

## Image Support

Menu items support `image` field:
- Empty string → shows category emoji icon as fallback
- Direct URL → `https://example.com/image.jpg`
- Google Drive → `https://drive.google.com/uc?id=FILE_ID` (auto-converted to thumbnail URL)

In Google Sheets, store Drive file IDs in the image column. The Apps Script uses `getDriveImageUrl(fileId)` to generate proper URLs.

## Branch Pricing

Override prices per branch in `branchPricing`:
```json
{
  "TBS": { "M001": 10.50 },
  "TBR": { "M001": 9.95 }
}
```

Items without branch overrides use the default `price`.

## WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `menu_update` | Server → Clients | Menu has changed, clients should reload |
| `menu_update` | Admin → Server | Admin triggers broadcast after editing |

## Troubleshooting

- **Menu not loading**: Check server is running, check browser console for API errors
- **Google sync fails**: Check GOOGLE_MENU_API env var, check Apps Script deployment permissions
- **Real-time not working**: Check WebSocket connection (look for 🟢/🔴 status indicators)
- **Offline mode**: Server uses `data/menu.json` cache — works without Google Sheets
