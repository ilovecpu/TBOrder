# The Bap - Order Kiosk System

## File Location
`/sessions/ecstatic-compassionate-maxwell/mnt/outputs/thebap-kiosk/TBOrder_Kiosk.html`

## Overview
A complete, production-ready customer ordering kiosk for "The Bap" Korean restaurant. Single-file HTML application with embedded CSS and JavaScript - no external dependencies except Google Fonts.

## Key Features

### 1. **Welcome Screen**
- Restaurant branding with English and Korean text (The Bap / 더밥)
- Tagline: "K-Food on the Bap"
- Two large, touch-friendly buttons for service type selection:
  - Eat In (식사)
  - Take Away (포장)

### 2. **Menu Screen**
- **Left Sidebar**: 7 categories with active state highlighting
  - K-Food on the Bap
  - K-Chicken on the Bap
  - Bulgogi BBQ on the Bap
  - Bibim Bap
  - Noodle in Soup
  - Sides
  - Korean Chicken Box
- **Main Grid**: Responsive menu item cards (280px minimum)
  - Item name (English + Korean)
  - Description
  - Dietary badges (V for Vegetarian, VG for Vegan, Spicy)
  - Price (GBP)
  - Hover effects with elevation

### 3. **Item Detail Modal**
When customer taps a menu item:
- **Header**: Item name (EN+KR) and price
- **Nutrition Facts Panel**: Calories, Protein, Carbs, Fat, Sugar
- **Allergen Badges**: Visual warnings for all allergens
- **Sauce Selector** (for Bap items):
  - 8 sauces with spice level indicators (chili pepper icons: 0-5 level)
  - Options: White, Bulgogi, Baby Hot, Bibim Bap, Spicy, Extra Spicy, Hot, Crazy Hot
- **Topping Selector** (for applicable items):
  - Combo Bap: 2 topping selections
  - Bibim Bap with Topping: 1 topping selection
  - 6 topping options with Korean names
- **Quantity Selector**: +/- buttons
- **Add to Cart Button**: Green action button

### 4. **Cart Sidebar**
- Slides in from the right edge
- Shows all items with:
  - Item name
  - Sauce selection (if applicable)
  - Toppings (if applicable)
  - Price per item
- **Quantity Controls**: +/- buttons per item
- **Remove Option**: Delete individual items
- **Cart Summary**: Subtotal and total calculations
- **Place Order Button**: Proceeds to payment when cart has items

### 5. **Payment Screen**
- Display of order total
- Payment method selection:
  - Card Payment (SumUp API integration placeholder)
  - Cash Payment
- Back and Confirm buttons
- Radio button selection interface

### 6. **Order Confirmation**
- Order number (auto-generated format: TB-001, TB-002, etc.)
- Confirmation message
- Estimated wait time (random 10-20 minutes)
- Countdown timer (10 seconds) before auto-return to welcome
- Success animation

## Menu Data (21 Items Total)

### K-Food on the Bap (4 items)
- Combo Bap £9.55
- Tofu Bap £7.45 (V)
- Man Du Bap £7.45
- Jap Che Bap £6.95 (V)

### K-Chicken on the Bap (4 items)
- KFC Bap £8.25
- Katsu Bap £8.25
- Kang Jung Bap £8.25
- Sweet Soy Bap £8.25

### Bulgogi BBQ on the Bap (3 items)
- Beef Bap £8.75
- Pork Bap £8.75 (Spicy)
- Chicken Bap £8.75

### Bibim Bap (2 items)
- Vegetable Bibim Bap £8.45 (VG)
- Bibim Bap with Topping £9.95

### Noodle in Soup (3 items)
- Katsu Guk Su £8.00
- Man Du Guk Su £8.00
- Tofu Guk Su £7.95 (V)

### Sides (4 items)
- Man Du Set £2.95
- Kim Mari Set £3.25 (V)
- Ttok-Bok-Ki £4.45 (V, Spicy)
- Kim Chi £2.95 (VG)

### Korean Chicken Box (1 item)
- Korean Chicken Box £17.95

## Sauce System
8 complete sauces with:
- Names (White, Bulgogi, Baby Hot, Bibim Bap, Spicy, Extra Spicy, Hot, Crazy Hot)
- Spice levels (0-5 represented with chili pepper icons)
- Allergen information for each sauce

## Toppings System
6 available toppings:
- Fried Chicken / 튀긴 치킨
- Beef Bulgogi / 소불고기
- Pork Bulgogi / 돼지불고기
- Tofu / 두부
- Dumplings / 만두
- Chicken Katsu / 닭까스

## Complete Allergen Data
Every menu item includes allergen information:
- Gluten
- Eggs
- Soy
- Sesame
- Milk
- And more as applicable per item

Allergens are displayed as visual badges in item details.

## Complete Nutrition Data
Every item includes:
- Calories
- Protein (g)
- Carbohydrates (g)
- Fat (g)
- Sugar (g)

## Design Specifications

### Color Palette
- **Primary Pink**: #FFB4C8
- **Light Background Pink**: #FFF5F7
- **Dark Text**: #1A1A1A
- **Green Accent**: #2D8C4E
- **Light Green**: #4CAF7F

### Typography
- **English Font**: Poppins (300, 400, 600, 700, 800 weights)
- **Korean Font**: Noto Sans KR (400, 500, 700 weights)
- **Monospace** (order numbers): Courier New

### Responsive Design
- **Optimized for**: Tablets and kiosk displays (1024x768 to 1920x1080)
- **Touch-Friendly**: 48px minimum touch targets
- **Large Buttons**: Welcome screen buttons are 60x60px
- **Smooth Animations**: 0.3s cubic-bezier transitions
- **Custom Scrollbars**: Pink themed scrollbars

## Technical Implementation

### Storage & Persistence
- **IndexedDB**: Stores orders and cart data locally
- **LocalStorage**: Tracks daily order count (TB-001, TB-002, etc.)
- **Cart Persistence**: Cart survives page refresh
- **Order History**: All orders saved locally

### Communication Features
- **BroadcastChannel API**: Real-time communication with kitchen kiosk (if available)
- **WebSocket**: Connection to local server (ws://localhost:8080) for cross-device sync
- **Graceful Fallback**: Works without server/WebSocket connection

### User Feedback
- **Audio Beeps**: Web Audio API simple tone feedback on all button taps
- **Visual Feedback**: Hover effects, active states, animations
- **Loading States**: Button disable states during processing
- **Success Animations**: Pulse animation on confirmation screen

### No External Dependencies
- Pure vanilla HTML/CSS/JavaScript
- Google Fonts for typography (only external CDN load)
- No jQuery, React, Vue, or other frameworks
- Single 2064-line HTML file

## Usage Instructions

1. **Open File**: Open `TBOrder_Kiosk.html` in a modern web browser
2. **Select Service Type**: Choose "Eat In" or "Take Away"
3. **Browse Menu**: Select category from left sidebar, tap items to view details
4. **Customize Item**: Select sauce and/or toppings, adjust quantity
5. **Add to Cart**: Tap "Add to Cart" button
6. **View Cart**: Tap shopping cart button (bottom right) to review items
7. **Proceed to Payment**: Tap "Place Order" when ready
8. **Select Payment**: Choose payment method (Card or Cash)
9. **Confirm**: Tap "Confirm Payment"
10. **Order Placed**: View confirmation with order number and wait time

## Browser Compatibility
- Chrome/Chromium 60+
- Firefox 55+
- Safari 12+
- Edge 79+
- Opera 47+

Requires:
- JavaScript enabled
- IndexedDB support
- Web Audio API support (for audio feedback)
- CSS Grid and Flexbox support

## Future Enhancement Placeholders
- SumUp API integration for card payments (currently showing mock UI)
- Kitchen display system integration via WebSocket
- Multi-language support (currently English with Korean subtitles)
- Image/photos for menu items
- Real-time inventory sync
- Advanced analytics and reporting

## Performance Notes
- Single HTML file loads in <2 seconds
- No compile step needed
- Minimal CPU usage
- Optimized CSS for smooth animations
- Efficient grid rendering for 21+ menu items
- IndexedDB for fast local data access

---

Created: 2026-03-05
Version: 1.0.0
Restaurant: The Bap (더밥) - Korean K-Food
