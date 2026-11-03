# CustomT Backend (Phase 1)

REST API and Socket.IO real-time reverse-auction engine for **CustomT: A Centralized E-commerce Marketplace and Reverse Auction Platform for Custom Apparel Procurement**.

Stack: Node.js 18+, Express 4, MongoDB Atlas (Mongoose 8), Socket.IO 4, JWT + bcryptjs.

---

## 1. Quick start

```bash
cd backend
npm install
cp .env.example .env        # then set MONGO_URI (Atlas) and JWT_SECRET
npm run seed                # admin + demo buyer + 4 demo vendors
npm run dev                 # http://localhost:5000
npm test                    # unit tests: scoring formula, CV diagnostic, EWMA, RFQ calculator
```

**MongoDB Atlas:** create a free M0 cluster, add a database user, allow your IP (or `0.0.0.0/0` for cloud hosting) under *Network Access*, and paste the driver connection string into `MONGO_URI` with `/customt` as the database name.

**Demo accounts** (after `npm run seed`). The demo password is `Demo@12345`; the admin uses `SEED_ADMIN_PASSWORD`.

| Role | Email | Notes |
|---|---|---|
| Admin | admin@customt.lk | password `Admin@12345` by default |
| Buyer | buyer@customt.lk | |
| Vendor | vendor1@customt.lk | Screen Printing, DTF, cap 1000, trust 4.4, verified |
| Vendor | vendor2@customt.lk | Embroidery, Screen Printing, cap 300, trust 3.9, verified |
| Vendor | vendor3@customt.lk | Sublimation, DTF, Screen Printing, cap 500, trust 3.5, verified |
| Vendor | vendor4@customt.lk | Screen Printing, cap 200, **pending verification** (PERA lock demo) |

> For a live viva demo, set `AUCTION_DURATION_MINUTES=5` so auctions expire and soft-close fires within minutes.

---

## 2. Project structure

```
backend/
├── server.js                  # Express app + HTTP server + Socket.IO bootstrap, graceful shutdown
├── config/
│   ├── env.js                 # .env loading & validation
│   ├── constants.js           # domain enums, weights, thresholds (single source of truth)
│   └── db.js                  # MongoDB Atlas connection
├── models/                    # User, RFQ, Bid, Order (Mongoose)
├── middleware/                # auth (JWT, roles, PERA lock), errorHandler, upload (multer)
├── services/
│   ├── scoringEngine.js       # multi-attribute scoring + price-variance diagnostic (pure)
│   ├── auctionService.js      # RFQ creation, bidding, soft-close, ranking, broadcasts, scheduler
│   ├── orderService.js        # award, escrow, milestones, O2O, EWMA trust, disputes
│   ├── mockPaymentGateway.js  # card validation (Luhn), approve/decline simulation
│   └── realtime.js            # Socket.IO emit helpers & room naming
├── sockets/index.js           # socket JWT handshake + auction events
├── routes/                    # auth, rfq, order, vendor, admin, meta, upload
├── utils/                     # ApiError, helpers, rfqCalculator, politenessTemplates, keyedMutex
├── scripts/seed.js
└── tests/scoringEngine.test.js
```

---

## 3. Core rules implemented

| Rule | Where |
|---|---|
| **PERA qualification lock**: `isVerified` and a license that has not expired | `User.qualificationIssues()`, `requirePrequalifiedVendor` |
| **PERA participant lock**: capability includes `printType` and `maxCapacity >= totalQuantity` | `User.checkRfqEligibility()` (REST and socket) |
| **PERA event lock**: an RFQ is refused (422 `PERA_EVENT_LOCK`) unless at least 1 prequalified vendor matches | `auctionService.createRfq` |
| **CPAPO spec lock**: `isLocked: true`; any edit to `designSpecs` returns 423 `CPAPO_SPEC_LOCK` | RFQ `pre('save')` and query hooks; `PUT/PATCH /api/rfqs/:id` |
| **MOQ 20**, auto `totalQuantity` and `expectedDeliveryDays` | `utils/rfqCalculator.js` |
| **Scoring** `((minPrice/price)*0.5) + ((trust/maxTrust)*0.3) + ((minLead/lead)*0.2)` | `scoringEngine.scoreBids` |
| **Rank-based partial visibility** | `buildLeaderboard` goes to the buyer/admin only; `buildVendorBidView` goes to vendors (own bid + rank only, no score) |
| **Soft-close**: a bid within the last 2 minutes adds 5 minutes | `auctionService.placeBid` |
| **Price-signal diagnostic**: 3 or more bids and CV above 0.35 | `computePriceDiagnostic` stored in `rfq.priceDiagnostic` |
| **Escrow split**: 30% released on `MATERIAL_SOURCED → IN_PRODUCTION`, 70% released on O2O | `orderService.advanceProduction`, `completeOrder` |
| **O2O PIN**: 6 digits, buyer-only, QR code, at most 5 attempts, regenerable | `orderService` |
| **Trust EWMA**: `0.7*old + 0.3*rating`, clamped to [1, 5] | `orderService.rateVendor` |
| **Politeness CRM**: tone screening, softened vendor-facing text, templated acknowledgements and resolutions | `utils/politenessTemplates.js` |

**Re-bidding policy:** a vendor holds one bid per RFQ and revises it as often as they like. Every revision is kept in `bid.revisions`. Raising the price is rejected unless `ALLOW_BID_PRICE_INCREASE=true`.

**Concurrency:** all bids and awards on one RFQ go through a per-RFQ in-process mutex, so ranking and soft-close never interleave. Escrow transitions use a per-order mutex. This is correct for a single API instance. To scale out horizontally you would need a distributed lock (e.g. Redis) and the Socket.IO Redis adapter.

---

## 4. State machines

```
RFQ:     OPEN ──(expiresAt, bids>0)──> CLOSED ──accept──> AWARDED
           │──(expiresAt, no bids)──> EXPIRED
           │──accept (early)───────────────────────────> AWARDED
           └──cancel──> CANCELLED

Order:   PENDING_ESCROW ─pay─> IN_PROGRESS ─READY_FOR_INSPECTION─> AWAITING_O2O ─PIN/approve─> COMPLETED
               └─cancel─> CANCELLED          └──────── dispute ──────────┴─> DISPUTED ─admin─> COMPLETED | REFUNDED | IN_PROGRESS

Escrow:  AWAITING_PAYMENT → ESCROW_LOCKED → PARTIALLY_RELEASED (30% out) → FUNDS_RELEASED (70% out)
                                   └───────────── FROZEN (dispute) ─> FUNDS_RELEASED | REFUNDED | SPLIT_SETTLED | (restored)

Production: NOT_STARTED → MATERIAL_SOURCED → IN_PRODUCTION → READY_FOR_INSPECTION → DELIVERED
```

---

## 5. REST API

Every response is `{ success, ... }`. Errors look like `{ success:false, message, code?, details? }`. Authenticated routes need `Authorization: Bearer <token>`.

### Auth: `/api/auth`
| Method | Path | Body | Role |
|---|---|---|---|
| POST | `/register` | buyer: `{role:"buyer", name, email, password, phone}`; vendor: `+ companyName, businessRegNo, capabilities[], maxCapacity, licenseExpiryDate?` | public |
| POST | `/login` | `{email, password}` → `{token, user}` | public |
| GET | `/me` | (vendors also receive `qualificationIssues[]`) | any |
| PATCH | `/me` | `{name?, phone?, companyName?, capabilities?, maxCapacity?, licenseExpiryDate?}`. Expanding vendor scope resets verification. | any |
| PATCH | `/me/password` | `{currentPassword, newPassword}` | any |

### Meta and uploads
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | DB status |
| GET | `/api/meta/catalog` | all configurator options, weights, statuses, test cards |
| POST | `/api/uploads/logo` | multipart field `logo` (png/jpg/webp/svg, 2 MB) → `{url}` to use as `designSpecs.logoUrl` |

### RFQs and bids: `/api/rfqs`
| Method | Path | Body / Notes | Role |
|---|---|---|---|
| POST | `/preview` | `designSpecs` → totalQuantity, expectedDeliveryDays, eligibleVendorCount | buyer |
| POST | `/` | `{title, description?, expectedDeliveryDays?, designSpecs:{garmentType, fabric, gsm, color, printType, printPlacement?, customText?, backText?, textColor?, logoUrl?, designPosition?, sizeBreakdown:{S,M,L,XL,XXL}}}` | buyer |
| GET | `/` | `?status=OPEN,CLOSED&search=&page=&limit=` (buyer: own RFQs; vendor: RFQs they bid on; admin: all) | any |
| GET | `/:id` | buyer/admin: `{rfq, leaderboard[], priceDiagnostic}`; vendor: `{rfq, myBid, rank, totalBids, rankLabel}` | any |
| PUT/PATCH | `/:id` | always **423 CPAPO_SPEC_LOCK** | buyer |
| POST | `/:id/cancel` | `{reason?}` | buyer |
| POST | `/:id/bids` | `{price (total LKR), leadTimeDays, notes?}`: place or revise a bid | prequalified vendor |
| POST | `/:id/bids/:bidId/accept` | awards the RFQ and creates the Order | buyer |

### Vendor: `/api/vendor`
| GET `/status` | PERA status banner |
|---|---|
| GET `/rfqs` | live feed of eligible OPEN RFQs, each with own rank |
| GET `/bids` | own bid history with rank and outcome |
| GET `/wallet` | balance, amount pending in escrow, payout ledger |

### Orders: `/api/orders`
| Method | Path | Body | Role |
|---|---|---|---|
| GET | `/` , `/:id` | `?status=` | party/admin |
| POST | `/:id/pay` | `{cardNumber, cardHolder, expiry:"MM/YY", cvv}` | buyer |
| POST | `/:id/cancel` | before payment only | buyer |
| PATCH | `/:id/production` | `{status, note?}`: the next step only | vendor |
| GET | `/:id/o2o` | `{pin, qrDataUrl, attemptsRemaining}` | buyer |
| POST | `/:id/o2o/regenerate` | new PIN; resets attempts | buyer |
| POST | `/:id/o2o/verify` | `{pin}`: releases 70% | vendor |
| POST | `/:id/o2o/approve` | buyer approves without the PIN hand-over | buyer |
| POST | `/:id/rate` | `{rating:1-5, review?}` → `{trustBefore, trustAfter}` | buyer |
| POST | `/:id/dispute` | `{category, description(20-2000), desiredResolution, evidenceUrls?}` | buyer |
| POST | `/:id/dispute/notes` | `{message}` | party/admin |

Dispute `category`: `PRINT_QUALITY, COLOR_MISMATCH, SIZE_DISCREPANCY, QUANTITY_SHORTFALL, FABRIC_ISSUE, DESIGN_DEVIATION, OTHER`. `desiredResolution`: `REPRINT, PARTIAL_REFUND, FULL_REFUND, OTHER`.

### Admin: `/api/admin`
| Method | Path | Body |
|---|---|---|
| GET | `/vendors?status=pending\|verified\|expired&search=` | |
| PATCH | `/vendors/:id/verification` | `{isVerified, licenseExpiryDate?, notes?}` |
| PATCH | `/vendors/:id/badges` | `{skillBadges:[...]}` |
| GET | `/users?role=&search=` | |
| PATCH | `/users/:id/status` | `{isActive}` (suspending also disconnects the user's sockets) |
| GET | `/auctions/live` | all OPEN auctions with leaderboards and diagnostics |
| GET | `/orders` | |
| GET | `/disputes?state=open\|resolved` | |
| POST | `/orders/:id/resolve` | `{resolution: RELEASE_TO_VENDOR\|REFUND_BUYER\|SPLIT\|RESUME_PRODUCTION, vendorPercent? (SPLIT), notes?}` |
| GET | `/analytics` | market intelligence: GMV, escrow, unit price by print type, savings %, bids/RFQ, soft-close stats, dispute rate, trends, top vendors, high-variance RFQs |

### Mock payment test cards
`4242 4242 4242 4242` approved · `5555 5555 5555 4444` approved · `4000 0000 0000 0002` declined · `4000 0000 0000 9995` insufficient funds. Use any future expiry and a 3-digit CVV.

---

## 6. Socket.IO contract

```js
import { io } from 'socket.io-client';
const socket = io(API_URL, { auth: { token } });
socket.emit('rfq:join', { rfqId }, (res) => res.ok ? setSnapshot(res.snapshot) : showError(res.error));
socket.emit('bid:place', { rfqId, price, leadTimeDays, notes }, (res) => ...);
```

Rooms: `user_<id>` (private), `role_<role>`, and `rfq_<id>`. The rfq room only ever receives non-sensitive activity.

| Event (server → client) | Receivers | Payload highlights |
|---|---|---|
| `rfq:new` | eligible vendors, admins | `{rfq}` |
| `auction:leaderboard` | RFQ buyer, admins | `{rfqId, leaderboard[], priceDiagnostic, expiresAt, bidCount}` |
| `auction:rank` | each bidding vendor (private) | `{rfqId, myBid, rank, totalBids, rankLabel, expiresAt, status}` |
| `auction:activity` | rfq room | `{bidCount, expiresAt, extensionCount}` |
| `auction:extended` | rfq room, buyer, admins | `{expiresAt, extensionCount, message}` |
| `auction:ended` | rfq room, buyer, admins | `{status: CLOSED\|EXPIRED}` |
| `auction:awarded` / `auction:lost` | winning / losing vendors | `{orderId?, orderCode?, message}` |
| `auction:closed` | rfq room | `{status}` |
| `order:created` / `order:updated` / `order:completed` | parties, admins | statuses and a message |
| `o2o:ready` | **buyer only** | `{pin, qrDataUrl}` |
| `o2o:failed-attempt` | buyer | `{attemptsRemaining}` |
| `dispute:raised` / `dispute:note` / `dispute:resolved` | parties | templated, polite messages |
| `dispute:new` | admins | `{category, toneFlagged, escrowHeld}` |
| `vendor:registered` | admins | new or re-verification vendor |
| `vendor:verification` / `vendor:badges` / `vendor:trust-updated` | that vendor | |

---

## 7. Production notes
* Set `NODE_ENV=production`, a 32+ character `JWT_SECRET`, and `CLIENT_URL` to the deployed frontend origin(s).
* Uploaded logos are stored on local disk in `uploads/`. Hosts with ephemeral disks (Render, Railway) lose them on redeploy, so use a persistent disk or swap `middleware/upload.js` for S3/Cloudinary.
* Run a single instance (see the concurrency note in section 3), or add Redis for locks and the Socket.IO adapter.
