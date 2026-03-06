# The Bap Order Kiosk - Implementation Guide

## Quick Start

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari, Edge, Opera)
- No server required (works standalone)
- No build tools needed

### Installation
1. Download `TBOrder_Kiosk.html`
2. Place on a web server OR open directly in browser via `file://` protocol
3. Open in browser on kiosk display (tablet/touchscreen)

### Display Setup
- **Recommended Resolution**: 1920x1080 (Full HD)
- **Minimum Resolution**: 1024x768 (iPad compatible)
- **Screen Size**: 10-27 inches
- **Touch Screen**: Capacitive touchscreen recommended
- **Orientation**: Portrait or Landscape (responsive)

---

## Screen-by-Screen Implementation

### Screen 1: Welcome Screen (ID: `welcomeScreen`)

**Duration**: 30+ seconds (until customer action)

**Components**:
- Logo: "The Bap" + Korean "더밥"
- Tagline: "K-Food on the Bap"
- Two buttons: "Eat In" (식사) & "Take Away" (포장)

**Features**:
- Idle auto-loop (returns to this screen after 10 seconds on confirmation)
- Large touch targets (300px wide minimum)
- Gradient background animation-ready

**Key JavaScript Objects**:
- Button listeners: `.welcome-btn` (data attribute: `data-type`)
- Service type stored in: `appState.serviceType`

---

### Screen 2: Menu Screen (ID: `menuScreen`)

**Duration**: Variable (until customer selects payment)

**Layout**:
```
┌─ Sidebar (280px) ──┬─── Main Content (Remaining) ───┐
│ Categories Menu   │  Menu Items Grid                │
│ (7 categories)    │  (Auto-layout grid)             │
└───────────────────┴─────────────────────────────────┘
+ Cart Toggle Button (bottom right)
```

**Categories** (in sidebar):
1. K-Food on the Bap (4 items)
2. K-Chicken on the Bap (4 items)
3. Bulgogi BBQ on the Bap (3 items)
4. Bibim Bap (2 items)
5. Noodle in Soup (3 items)
6. Sides (4 items)
7. Korean Chicken Box (1 item)

**Menu Items Grid**:
- 3-4 cards per row (responsive)
- Minimum card width: 280px
- Card content: Image space (planned), name, Korean name, description, badges, price

**Key JavaScript**:
- `renderCategories()`: Build sidebar
- `renderMenuItems()`: Build grid for current category
- `appState.currentCategory`: Tracks active category
- Click handler: `openItemModal(item)`

---

### Screen 3: Item Detail Modal (ID: `itemModal`)

**Triggered**: When customer taps menu item card

**Structure**:
```
┌─────────────────────────────────────────────────┐
│ [✕]  Item Name (EN)                    [Price] │
│      Item Name (KR)                            │
│                                                 │
│ Description text...                            │
│                                                 │
│ ┌─ NUTRITION FACTS ──────────────────────────┐ │
│ │ Calories: 520     │ Protein: 25g           │ │
│ │ Carbs: 68g        │ Fat: 12g               │ │
│ │ Sugar: 4g         │                        │ │
│ └────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ ALLERGENS ────────────────────────────────┐ │
│ │ [⚠️ Gluten] [⚠️ Soy] [⚠️ Sesame]          │ │
│ └────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ SELECT SAUCE (if applicable) ─────────────┐ │
│ │ ○ White           [○○○○○ Not Spicy]       │ │
│ │ ○ Bulgogi         [○○○○○ Not Spicy]       │ │
│ │ ● Baby Hot        [●○○○○ Mildly Spicy]   │ │
│ │ ○ Bibim Bap       [●●○○○ Medium]         │ │
│ │ ... (8 total)                             │ │
│ └────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ SELECT TOPPING (if applicable) ──────────┐ │
│ │ ○ Fried Chicken / 튀긴 치킨         →      │ │
│ │ ○ Beef Bulgogi / 소불고기           →      │ │
│ │ ... (6 total, max 1-2 per item)        │ │
│ └────────────────────────────────────────────┘ │
│                                                 │
│ QUANTITY: [−] 1 [+]                           │
│                                                 │
│ ┌──────────────────────────────────────────┐  │
│ │     [ADD TO CART]                        │  │
│ └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Features**:
- Close button (✕) or click overlay
- Dynamic nutrition data
- Conditional sauce selector (based on `item.hasSauce`)
- Conditional topping selector (based on `item.hasToppings`)
- Quantity controls (min: 1, max: unlimited)
- Add to Cart handler

**Key JavaScript**:
- `openItemModal(item)`: Initialize modal with item data
- `appState.currentItem`: Current viewing item
- `appState.selectedSauce`: Index of SAUCES array
- `appState.selectedToppings[]`: Array of topping IDs
- `appState.quantity`: Current quantity (1+)

---

### Screen 4: Cart Sidebar (ID: `cartSidebar`)

**Position**: Slides from right edge
**Width**: 420px (desktop), 350px (tablet)
**Trigger**: "🛒" button (bottom right)

**Structure**:
```
┌────────────────────────────┐
│ Your Cart          [✕]     │  <- Header
├────────────────────────────┤
│                            │
│ [Item 1]                   │
│ Fried Chicken              │
│ Sauce: Baby Hot            │
│ Topping: Beef Bulgogi      │
│ Price: £8.25               │
│ [−] 1 [+]  [REMOVE]        │  <- Item with controls
│                            │
│ [Item 2]                   │
│ ... (repeats)              │
│                            │
│ (Scrollable area)          │
│                            │
├────────────────────────────┤
│ Subtotal: £XX.XX           │  <- Footer
│ TOTAL:    £XX.XX           │
│                            │
│ [PLACE ORDER]              │
└────────────────────────────┘
```

**Features**:
- Cart count badge ("🛒 3")
- Item-level quantity controls
- Remove buttons per item
- Real-time total calculation
- "Place Order" button disabled if cart empty
- Smooth slide animation

**Key JavaScript**:
- `appState.cart[]`: Array of cart items
- `updateCart()`: Recalculate totals, render items
- `saveCartToDB()`: Persist to IndexedDB
- `loadCartFromDB()`: Load saved cart on startup

---

### Screen 5: Payment Screen (ID: `paymentScreen`)

**Triggered**: When customer taps "Place Order"

**Structure**:
```
┌────────────────────────────┐
│                            │
│    PAYMENT METHOD          │
│                            │
│    £XX.XX                  │
│                            │
│ ◉ 💳 Card Payment (SumUp) │  <- Selected
│                            │
│ ○ 💵 Cash Payment         │
│                            │
│ [BACK]    [CONFIRM PAYMENT]│
│                            │
└────────────────────────────┘
```

**Features**:
- Large amount display
- Two payment method options
- Radio button selection
- Back (returns to menu with cart open) and Confirm buttons

**Key JavaScript**:
- `appState.paymentMethod`: 'card' or 'cash'
- `.payment-method` click handlers
- `processOrder()`: Main order processing function

---

### Screen 6: Confirmation Screen (ID: `confirmationScreen`)

**Duration**: 10 seconds (auto-return to welcome)

**Structure**:
```
┌────────────────────────────┐
│                            │
│           ✓ (animated)     │
│                            │
│    ORDER PLACED!           │
│                            │
│      TB-001                │  <- Order number
│                            │
│ Your order has been        │
│     confirmed              │
│                            │
│ Estimated wait time:       │
│      15 minutes            │
│                            │
│ Returning in 10 seconds... │
│                            │
└────────────────────────────┘
```

**Features**:
- Order number: Auto-increment, daily reset (TB-001, TB-002, etc.)
- Estimated time: Random 10-20 minutes
- Countdown timer: 10 seconds
- Success animation (✓ pulse effect)
- Auto-return to welcome screen

**Key JavaScript**:
- `getNextOrderNumber()`: Generate TB-NNN
- `showConfirmation(orderNumber)`: Display and countdown
- `saveOrderToDB(order)`: Persist to IndexedDB
- Auto-return trigger: `showScreen('welcomeScreen')`

---

## Data Structures

### MENU_DATA
```javascript
{
  'Category Name': [
    {
      id: 0,
      name: 'Item Name',
      nameKr: '한글이름',
      description: 'Description',
      price: 9.55,
      category: 'Category Name',
      tags: ['V', 'Spicy'], // 'V', 'VG', 'Spicy'
      nutrition: { carbs, protein, fat, sugar, calories },
      allergens: ['Gluten', 'Soy', ...],
      hasSauce: true/false,
      hasToppings: true/false,
      toppingCount: 1 or 2 (if hasToppings)
    },
    ...
  ],
  ...
}
```

### SAUCES Array
```javascript
{
  name: 'Sauce Name',
  spiceLevel: 0-5,        // 0=mild, 5=hottest
  allergens: ['...']
}
```

### TOPPINGS Array
```javascript
{
  id: 't1',
  name: 'English Name',
  nameKr: '한글이름'
}
```

### Cart Item
```javascript
{
  id: 'unique-id-timestamp',
  itemId: 0,
  name: 'Item Name',
  nameKr: '한글이름',
  price: 8.25,
  sauce: { name: 'Baby Hot', spiceLevel: 1, ... },
  toppings: [{ id: 't1', name: 'Fried Chicken', nameKr: '...' }],
  quantity: 1  // Always 1 (multiples = multiple cart entries)
}
```

### Order
```javascript
{
  orderNumber: 'TB-001',
  serviceType: 'eat-in' or 'takeaway',
  paymentMethod: 'card' or 'cash',
  items: [ /* cart items */ ],
  total: 45.50,
  timestamp: '2026-03-05T23:17:00.000Z',
  status: 'pending' // pending, confirmed, ready, completed
}
```

---

## Storage & Persistence

### IndexedDB Database: `TheBapKiosk`

**Object Store: `orders`**
- Stores all placed orders
- Can be synced to backend
- Useful for kitchen display and order history

**Object Store: `cart`**
- Persists current cart
- Auto-loaded on page refresh
- Cleared after order placement

### LocalStorage
- Key: `orders_YYYY-MM-DD` (e.g., `orders_2026-03-05`)
- Value: Order counter (used for TB-001, TB-002, etc.)
- Auto-incremented per day

---

## Integration Points

### 1. SumUp Card Payment
**Current**: Mock UI (button tap responds but no actual processing)
**To Implement**:
```javascript
// In processOrder() after payment confirmation
const sumupPayment = new SumupWebSDK();
sumupPayment.pay({
  amount: orderTotal * 100, // in cents
  currency: 'GBP',
  orderId: orderNumber,
  receiptEmail: customerEmail
});
```

### 2. Kitchen Display System
**Current**: Two communication methods included
- **BroadcastChannel API**: Cross-tab communication (same browser)
- **WebSocket**: Network communication (ws://localhost:8080)

**Usage**:
Order automatically sent to kitchen on confirmation via both channels

### 3. Order Tracking
**Future**: Real-time status updates
- Listen for order status changes
- Update estimated time dynamically
- Send notifications when order is ready

---

## Customization Guide

### Change Restaurant Name
**File**: TBOrder_Kiosk.html
**Lines**: Look for "The Bap" and "더밥"
```html
<div class="welcome-logo">The Bap</div>
<div class="welcome-logo-korean">더밥</div>
<div class="welcome-tagline">K-Food on the Bap</div>
```

### Change Colors
**CSS Variables** (in `<style>` section):
```css
--pink-primary: #FFB4C8;      /* Change this */
--green: #2D8C4E;             /* Change this */
--dark: #1A1A1A;              /* Change this */
```

### Add/Remove Menu Items
**JavaScript** (in `<script>` section):
```javascript
const MENU_DATA = {
  'Category': [
    { id: 21, name: 'New Item', ... },  // Add here
  ]
}
```

### Add/Remove Sauces
**JavaScript**:
```javascript
const SAUCES = [
  { name: 'New Sauce', spiceLevel: 3, allergens: [...] },
  // Add here
]
```

### Change Currency
**Search**: `formatPrice()` function
**Change**: `return £` to `return $` (or any currency symbol)

---

## Performance Optimization Tips

### For Kiosk Hardware
1. **Disable screen sleep**: System settings
2. **Set fixed zoom**: Browser -> 100% (no pinch zoom)
3. **Cache files**: Browser will cache HTML locally
4. **Monitor storage**: IndexedDB has ~50MB limit per domain
5. **Regular cleanup**: Run cleanup script weekly to archive old orders

### For Network Optimization
1. **Local WebSocket server**: Faster than cloud services
2. **Batch sync**: Sync orders hourly instead of per-order
3. **Image optimization**: If adding menu photos, compress <100KB each
4. **CDN**: Google Fonts loads from CDN (already optimized)

---

## Troubleshooting

### Cart Not Persisting
- Check IndexedDB permission in browser settings
- Verify browser supports IndexedDB
- Clear browser cache and reload

### Audio Not Working
- Check system volume
- Verify browser allows Web Audio API
- Test in different browser

### Modal Not Closing
- Ensure JavaScript is enabled
- Check browser console for errors
- Try refreshing page

### Order Not Sending to Kitchen
- WebSocket server may be down (graceful fallback works)
- Check BroadcastChannel permissions
- Orders saved locally regardless

---

## Testing Checklist

- [ ] Welcome screen appears on load
- [ ] "Eat In" and "Take Away" buttons work
- [ ] Menu categories load correctly (7 categories)
- [ ] Menu items appear in grid (21 items total)
- [ ] Clicking item opens modal
- [ ] Sauce selector works (shows 8 sauces, spice levels visible)
- [ ] Topping selector works (Combo Bap allows 2, Bibim allows 1)
- [ ] Quantity +/- buttons work
- [ ] Add to cart button works
- [ ] Cart count updates correctly
- [ ] Cart sidebar opens/closes smoothly
- [ ] Cart items show correct prices and details
- [ ] Remove item button works
- [ ] Cart total calculates correctly
- [ ] "Place Order" button triggers payment screen
- [ ] Payment methods selectable
- [ ] "Confirm Payment" shows confirmation screen
- [ ] Order number displays (TB-XXX format)
- [ ] Countdown timer works (10 seconds)
- [ ] Auto-return to welcome screen works
- [ ] Cart persists after page refresh
- [ ] Audio feedback on all button taps
- [ ] Responsive on different screen sizes

---

## Support & Maintenance

### Regular Maintenance Tasks
1. **Weekly**: Monitor IndexedDB storage size
2. **Monthly**: Review order history data
3. **Quarterly**: Update menu items/prices as needed
4. **As Needed**: Backup order data from IndexedDB

### Backup Process
1. Open browser DevTools (F12)
2. IndexedDB → TheBapKiosk → orders
3. Export data to CSV/JSON
4. Archive for record keeping

---

## Version History
- **v1.0.0** (2026-03-05): Initial release
  - 21 menu items
  - 8 sauces with spice levels
  - 6 toppings
  - Complete allergen/nutrition data
  - Card & cash payment options
  - Local order storage
  - Kitchen communication ready

---

For questions or updates, contact The Bap management.
