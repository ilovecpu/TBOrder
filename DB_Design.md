# The Bap (더밥) Database Design
## Google Sheets Schema for Multi-Branch System

> Designed for 5+ branches, scalability, speed, and ease of use
> Shared across: TBMS, Order Kiosk, POS System

---

## 1. TBMenu.gsheet — Centralized Menu Database

### Sheet 1: `Categories`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Category ID | `CAT001` |
| `nameEn` | String | English name | `Baps` |
| `nameKr` | String | Korean name | `밥` |
| `icon` | String | Emoji icon | `🍚` |
| `sortOrder` | Number | Display order | `1` |
| `type` | String | `food` / `drink` / `snack` / `combo` | `food` |
| `showOnKiosk` | Boolean | Show on order kiosk | `TRUE` |
| `showOnPos` | Boolean | Show on POS | `TRUE` |
| `showOnMobile` | Boolean | Show on mobile order | `TRUE` |
| `active` | Boolean | Active status | `TRUE` |

### Sheet 2: `MenuItems`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Menu item ID | `M001` |
| `categoryId` | String (FK) | Links to Categories.id | `CAT001` |
| `nameEn` | String | English name | `Spicy Beef Bap` |
| `nameKr` | String | Korean name | `매운 쇠고기 밥` |
| `descriptionEn` | String | English description | `Tender beef with gochujang` |
| `descriptionKr` | String | Korean description | `부드러운 소고기 고추장 소스` |
| `basePrice` | Number | Default price (£) | `5.99` |
| `costPrice` | Number | Cost price (£) for profit calc | `2.10` |
| `imageFileName` | String | File name in Google Drive TBFood_Photos | `spicy_beef.jpg` |
| `imageUrl` | String | Cached full URL (auto-generated) | `https://drive.google...` |
| `dietary` | String | Comma-separated tags | `spicy,halal` |
| `isCombo` | Boolean | Is combo item? | `FALSE` |
| `hasTopping` | Boolean | Allows toppings? | `TRUE` |
| `hasSauce` | Boolean | Requires sauce selection? | `TRUE` |
| `prepTime` | Number | Estimated prep minutes | `5` |
| `calories` | Number | Calorie count | `450` |
| `sortOrder` | Number | Display order within category | `1` |
| `active` | Boolean | Active status | `TRUE` |
| `createdAt` | DateTime | Created timestamp | `2026-03-06T10:00:00` |
| `updatedAt` | DateTime | Last updated | `2026-03-06T10:00:00` |

### Sheet 3: `Sauces`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Sauce ID | `SA001` |
| `nameEn` | String | English name | `Gochujang Hot` |
| `nameKr` | String | Korean name | `고추장 핫` |
| `descriptionEn` | String | English description | `Traditional Korean chili paste` |
| `spiceLevel` | Number | 1-5 spice rating | `4` |
| `allergens` | String | Comma-separated allergens | `Soy,Gluten` |
| `imageFileName` | String | Image in TBFood_Photos | `gochujang.jpg` |
| `sortOrder` | Number | Display order | `1` |
| `active` | Boolean | Active status | `TRUE` |

### Sheet 4: `Toppings`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Topping ID | `TP001` |
| `nameEn` | String | English name | `Extra Cheese` |
| `nameKr` | String | Korean name | `치즈 추가` |
| `price` | Number | Additional price (£) | `0.50` |
| `allergens` | String | Allergens | `Milk` |
| `sortOrder` | Number | Display order | `1` |
| `active` | Boolean | Active | `TRUE` |

### Sheet 5: `Allergens`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `menuItemId` | String (FK) | Links to MenuItems.id | `M001` |
| `allergen` | String | Allergen name | `Sesame` |
| `contains` | String | `yes` / `may` / `no` | `yes` |

### Sheet 6: `Nutrition`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `menuItemId` | String (FK) | Links to MenuItems.id | `M001` |
| `calories` | Number | kcal | `450` |
| `protein` | Number | grams | `22` |
| `carbs` | Number | grams | `55` |
| `fat` | Number | grams | `15` |
| `fibre` | Number | grams | `3` |
| `salt` | Number | grams | `1.2` |
| `sugar` | Number | grams | `8` |

### Sheet 7: `BranchPricing`
> Override base price per branch (if not set, uses basePrice)

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `branchCode` | String (FK) | Branch code | `TBS` |
| `menuItemId` | String (FK) | Links to MenuItems.id | `M001` |
| `price` | Number | Branch-specific price (£) | `6.49` |
| `active` | Boolean | Available at this branch | `TRUE` |

### Sheet 8: `BranchVisibility`
> Which menu items are visible at which branch/channel

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `branchCode` | String (FK) | Branch code | `TBS` |
| `menuItemId` | String (FK) | Links to MenuItems.id | `M001` |
| `showOnKiosk` | Boolean | Show on kiosk at this branch | `TRUE` |
| `showOnPos` | Boolean | Show on POS at this branch | `TRUE` |
| `showOnMobile` | Boolean | Show on mobile at this branch | `TRUE` |

### Sheet 9: `ComboItems`
> Defines what items make up a combo

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `comboId` | String (FK) | The combo MenuItems.id | `M006` |
| `menuItemId` | String (FK) | Included item | `M001` |
| `quantity` | Number | Qty in combo | `1` |
| `isOptional` | Boolean | Can customer choose? | `FALSE` |

---

## 2. TBOrder.gsheet — Order System Data

### Sheet 1: `Orders`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Order ID | `ORD-20260306-001` |
| `orderNumber` | String | Display number | `#001` |
| `branchCode` | String (FK) | Branch code | `TBS` |
| `customerName` | String | Customer name (optional) | `John` |
| `orderType` | String | `eat_in` / `takeaway` | `eat_in` |
| `orderSource` | String | `kiosk` / `mobile` / `pos` / `phone` | `kiosk` |
| `status` | String | `pending`/`preparing`/`done`/`cancelled` | `pending` |
| `subtotal` | Number | Before discount/tax | `12.48` |
| `discount` | Number | Discount amount | `0.00` |
| `tax` | Number | VAT amount | `2.08` |
| `total` | Number | Final total | `12.48` |
| `paymentMethod` | String | `card`/`cash`/`online`/`counter` | `counter` |
| `paymentStatus` | String | `pending`/`paid`/`refunded` | `pending` |
| `note` | String | Special instructions | `No spice please` |
| `staffId` | String | Staff who processed (POS) | `s1` |
| `createdAt` | DateTime | Order timestamp | `2026-03-06T12:30:00` |
| `completedAt` | DateTime | When marked done | `2026-03-06T12:45:00` |
| `date` | String | Date partition key (YYYY-MM-DD) | `2026-03-06` |

### Sheet 2: `OrderItems`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Line item ID | `OI-001` |
| `orderId` | String (FK) | Links to Orders.id | `ORD-20260306-001` |
| `menuItemId` | String (FK) | Links to MenuItems.id | `M001` |
| `nameEn` | String | Item name (snapshot) | `Spicy Beef Bap` |
| `quantity` | Number | Qty ordered | `1` |
| `unitPrice` | Number | Price at time of order | `5.99` |
| `totalPrice` | Number | qty × unitPrice | `5.99` |
| `sauceId` | String (FK) | Selected sauce | `SA001` |
| `sauceName` | String | Sauce name (snapshot) | `Gochujang Hot` |
| `toppings` | String | Comma-separated topping IDs | `TP001,TP003` |
| `toppingNames` | String | Topping names (snapshot) | `Extra Cheese,Kimchi` |
| `toppingPrice` | Number | Extra topping cost | `1.00` |
| `note` | String | Item-level note | `Extra spicy` |
| `date` | String | Date partition key | `2026-03-06` |

### Sheet 3: `DailySummary`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `date` | String (PK) | YYYY-MM-DD | `2026-03-06` |
| `branchCode` | String (PK) | Branch code | `TBS` |
| `totalOrders` | Number | Total orders count | `85` |
| `totalRevenue` | Number | Total revenue (£) | `523.45` |
| `eatInCount` | Number | Eat-in orders | `52` |
| `takeawayCount` | Number | Takeaway orders | `33` |
| `kioskOrders` | Number | Orders from kiosk | `60` |
| `mobileOrders` | Number | Orders from mobile | `15` |
| `posOrders` | Number | Orders from POS | `10` |
| `avgOrderValue` | Number | Average order £ | `6.16` |
| `cancelledCount` | Number | Cancelled orders | `2` |
| `topItem1` | String | Top selling item | `M001` |
| `topItem1Qty` | Number | Top item quantity | `25` |
| `topItem2` | String | 2nd best seller | `M008` |
| `topItem2Qty` | Number | 2nd item qty | `18` |
| `topItem3` | String | 3rd best seller | `M002` |
| `topItem3Qty` | Number | 3rd item qty | `15` |

---

## 3. TBPos.gsheet — POS System Data

### Sheet 1: `Transactions`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Transaction ID | `TXN-20260306-001` |
| `branchCode` | String (FK) | Branch code | `TBS` |
| `orderId` | String (FK) | Links to Orders.id (if from order) | `ORD-20260306-001` |
| `type` | String | `sale`/`refund`/`void`/`adjustment` | `sale` |
| `paymentMethod` | String | `cash`/`card`/`contactless`/`online` | `card` |
| `subtotal` | Number | Before tax | `12.48` |
| `discount` | Number | Discount | `0.00` |
| `tax` | Number | VAT | `2.08` |
| `total` | Number | Final amount | `12.48` |
| `cashReceived` | Number | Cash given (for change calc) | `15.00` |
| `changeGiven` | Number | Change returned | `2.52` |
| `staffId` | String (FK) | Staff who processed | `s1` |
| `staffName` | String | Staff name (snapshot) | `DJ` |
| `note` | String | Transaction note | `` |
| `createdAt` | DateTime | Timestamp | `2026-03-06T12:30:00` |
| `date` | String | Date partition key | `2026-03-06` |

### Sheet 2: `CashRegister`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Register event ID | `CR-001` |
| `branchCode` | String (FK) | Branch code | `TBS` |
| `type` | String | `open`/`close`/`cash_in`/`cash_out` | `open` |
| `amount` | Number | Amount (£) | `100.00` |
| `expectedAmount` | Number | System-calculated amount | `523.45` |
| `actualAmount` | Number | Hand-counted amount | `520.00` |
| `difference` | Number | Discrepancy | `-3.45` |
| `staffId` | String (FK) | Staff who did this | `s1` |
| `note` | String | Note | `Opening float` |
| `createdAt` | DateTime | Timestamp | `2026-03-06T09:00:00` |
| `date` | String | Date partition key | `2026-03-06` |

### Sheet 3: `DailyReport`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `date` | String (PK) | YYYY-MM-DD | `2026-03-06` |
| `branchCode` | String (PK) | Branch code | `TBS` |
| `openingFloat` | Number | Opening cash | `100.00` |
| `totalCashSales` | Number | Cash payments | `215.30` |
| `totalCardSales` | Number | Card payments | `308.15` |
| `totalContactless` | Number | Contactless | `156.20` |
| `totalOnline` | Number | Online payments | `45.80` |
| `totalRevenue` | Number | Grand total | `725.45` |
| `totalRefunds` | Number | Total refunded | `12.48` |
| `totalDiscount` | Number | Total discounts | `5.00` |
| `totalVAT` | Number | Total VAT collected | `120.91` |
| `netRevenue` | Number | After refunds & disc. | `707.97` |
| `closingCash` | Number | Actual cash at close | `312.00` |
| `expectedCash` | Number | Expected cash | `315.30` |
| `cashDifference` | Number | Over/under | `-3.30` |
| `totalTransactions` | Number | Total transactions | `95` |
| `voidCount` | Number | Voided transactions | `1` |
| `refundCount` | Number | Refund count | `1` |
| `staffOnDuty` | String | Staff IDs on duty | `s1,s2,s3` |
| `closedBy` | String | Staff who closed | `s1` |
| `closedAt` | DateTime | Closing timestamp | `2026-03-06T22:00:00` |

### Sheet 4: `Discounts`
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | String (PK) | Discount ID | `DISC001` |
| `name` | String | Discount name | `Staff 50%` |
| `type` | String | `percentage` / `fixed` | `percentage` |
| `value` | Number | Amount (% or £) | `50` |
| `minOrder` | Number | Minimum order value | `0` |
| `maxDiscount` | Number | Max discount cap | `10.00` |
| `applicableTo` | String | `all`/`food`/`drink`/specific item IDs | `all` |
| `startDate` | String | Valid from | `2026-01-01` |
| `endDate` | String | Valid until (empty=forever) | `` |
| `branchCodes` | String | Which branches (empty=all) | `TBS,TBR` |
| `active` | Boolean | Active status | `TRUE` |

---

## Design Notes

### Performance Optimization
- **Date partition key**: Every order/transaction has a `date` field for fast filtering
- **Snapshot fields**: Item names, sauce names stored with orders so historical data is self-contained (no JOINs needed)
- **Separate daily summary**: Pre-aggregated stats to avoid scanning all orders
- **Branch-level data**: Everything is branch-partitioned for fast per-store queries

### Scalability for 5+ Branches
- `branchCode` on every transactional record
- `BranchPricing` allows per-branch price overrides (e.g., London vs Swindon pricing)
- `BranchVisibility` controls what shows on each channel per branch
- All branch codes from TBMS: `PAB`, `TBS`, `TBR`, `TBB` (+ future branches)

### Data Sync Strategy
- **TBMenu**: READ by all systems (kiosk, POS, mobile), WRITE by TBMS & admin only
- **TBOrder**: WRITE by kiosk & mobile & POS, READ by kitchen & admin & TBMS
- **TBPos**: WRITE by POS only, READ by admin & TBMS

### Google Drive Integration
- Menu images stored in `TBFood_Photos/` folder on Google Drive
- `imageFileName` in MenuItems references the file in this folder
- Apps Script auto-generates public URL into `imageUrl` field
- Images accessed by all frontends via cached URL

### VAT (UK)
- Standard rate: 20% for eat-in
- Takeaway hot food: 20% (same as eat-in in UK)
- Cold food takeaway: 0% (future consideration)
