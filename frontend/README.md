# CustomT Frontend

React 18 + Vite 6, Tailwind CSS 4, React Router 7, Axios, Socket.IO client and Lucide icons.

## Run

```bash
cd frontend
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:5000
npm run dev               # http://localhost:5173
```

The backend must be running (`cd backend && npm run dev`) with `CLIENT_URL=http://localhost:5173` so CORS and Socket.IO accept the origin.

## Structure

```
src/
├── api/client.js               # axios instance, JWT interceptor, normalised errors, all endpoint calls
├── context/
│   ├── AuthContext.jsx         # session, login/register/logout, roleHome()
│   ├── SocketContext.jsx       # authenticated socket, notification centre, useSocketEvent(s), emitWithAck
│   ├── CatalogContext.jsx      # /api/meta/catalog (options, weights, statuses, test cards)
│   └── ToastContext.jsx
├── components/
│   ├── ui/                     # Button, Card, Modal, Badge, StatusBadge, TrustStars, Countdown, form controls…
│   ├── layout/                 # AppLayout (nav, live indicator, bell, user menu), ProtectedRoute
│   ├── configurator/           # TShirtPreview (layered SVG, 4 views), Shirt3DViewer (three.js, adaptive quality, camera presets)
│   ├── studio/                 # Design studio panes: StudioUI (dark primitives), ArtworkPanels (pattern, layers, inspector)
│   ├── feed/                   # PostCard (gallery, size chart, type-based call to action), PostComposer (vendor)
│   ├── auction/                # Leaderboard + ScoreBar, PriceDiagnosticAlert, SpecSummary
│   └── orders/                 # OrderProgress, EscrowBreakdown, PaymentModal, O2OPanel, DisputeModal, DisputeThread, RatingModal
└── pages/
    ├── Landing, Account, NotFound
    ├── auth/                   # Login (demo quick-fill), Register (everyone starts as a buyer)
    ├── feed/                   # GlobalFeed (infinite scroll), VendorStorefront (micro-storefront, Direct Quote)
    ├── buyer/                  # Dashboard, Configurator (3-pane design studio), RFQList, RFQDetail (live auction), OrdersList, OrderDetail
    ├── vendor/                 # VendorDashboard, RFQFeed (live), AuctionRoom (rank-only), MyBids, VendorOrders, VendorOrderDetail, Wallet
    └── admin/                  # AdminOverview, VendorVerification, LiveAuctions, Disputes, AdminOrders, AdminOrderDetail, Analytics, UsersAdmin
```

## Buyer flow

0. **Discover** (`/feed`, the buyer home): an infinite-scroll feed of posts from verified vendors, filterable by Premium Catalog, Inspiration and Clearance. Each card's button depends on the post type:
   - Premium Catalog: **Get a direct quote**, which opens the configurator for that vendor with the garment, fabric and GSM prefilled.
   - Clearance: **Request this stock**, a Direct Quote to that vendor.
   - Inspiration: **Design something similar**, an open auction with the garment prefilled.

   Clicking a vendor opens their storefront (`/vendors/:id`): cover photo, trust score, badges, three post tabs and **Request Direct Quote** (`/buyer/rfqs/new?vendorId=…`). A Direct Quote is seen and quoted only by that vendor, and is still paid through escrow and released with the O2O PIN.

1. **Design & Launch** (`/buyer/rfqs/new`): pick garment, fabric, GSM, colour and print method. Design the Front, Back, Left sleeve and Right sleeve: add several text layers (font, size, colour) and images per side, drag them on the live preview, and open **View in 3D** to rotate, zoom and pan a 3D model wearing the design, and fill the S–XXL matrix (MOQ 20). Delivery days are estimated instantly. The eligible-vendor count (PERA event lock) is checked live against the server. The draft is saved in the browser.
2. **Live auction** (`/buyer/rfqs/:id`): joins the `rfq_<id>` room. Shows the full ranked leaderboard with score breakdown bars, soft-close countdown and extension notices, and the price-variance warning. Accept any bid, or cancel the RFQ.
3. **Order** (`/buyer/orders/:id`):
   - Fund escrow through the mock gateway (test cards listed in the dialog).
   - Watch the production milestones.
   - Use the O2O PIN/QR, or approve the inspection directly.
   - Raise a dispute, which freezes escrow and uses the politeness-screened form.
   - Rate the vendor, which updates their trust score.

## Vendor flow

Vendors open **Storefront** in the menu to publish posts (**New post**) and edit the cover photo and bio. Premium Catalog posts require a size chart and fabric specs. Contact details in post text are removed by the server. Direct Quote requests appear in **Live RFQs** marked *Direct quote for you*.

All `/vendor` pages sit inside `VendorStatusLayout`, which loads the PERA qualification status and refreshes it live when an admin verifies the vendor. `PeraGate` replaces the auction pages with a lock screen until the vendor is prequalified.

1. **Live RFQs** (`/vendor/rfqs`): only open RFQs that match the vendor's capabilities and capacity. New RFQs arrive instantly (`rfq:new`). The page joins each RFQ's room, so bid counts, timers and soft-close extensions stay live. Each card shows the vendor's own rank only.
2. **Bidding modal**:
   - The vendor enters a total or per-piece price and a lead time, and sees a warning if it exceeds the buyer's target.
   - Re-bids get quick-lower buttons (−1/2/5%). Price increases are blocked unless the server allows them.
   - Bids go over Socket.IO with an acknowledgement, falling back to REST when the socket is down.
   - The result shows the new rank and any soft-close extension.
3. **Auction room** (`/vendor/rfqs/:id`): rank display with a trend arrow, a toast when the vendor is outranked, their own revision history, the buyer's notes, the locked specification, and win/loss/closed banners.
4. **Orders** (`/vendor/orders/:id`):
   - Production milestones: *Material sourced → In production* (credits the 30% advance) → *Ready for inspection* (issues the buyer's PIN).
   - O2O verification: a 6-box PIN input with paste support, plus an optional camera QR scan where the browser supports `BarcodeDetector`. The remaining attempts and the lockout are shown.
   - The vendor can reply in the dispute thread.
5. **Wallet** and **My Bids**: payout ledger, escrow still pending, win rate and re-bid statistics.

## Admin flow

1. **Overview** (`/admin`): KPIs, the demand trend, vendors awaiting verification, open disputes, and live auctions flagged for price variance. Everything refreshes on socket events.
2. **KYB** (`/admin/kyb`): review vendor applications. Open each document (every view is logged), accept it or give a reason, then approve (the buyer account becomes a vendor), request changes, or reject (30-day wait before reapplying).
3. **Vendors** (`/admin/vendors`): manage existing vendor accounts: licence renewals, revoking verification, skill badges.
3. **Auctions** (`/admin/auctions`): full leaderboards of every open auction, updated live, with variance and no-bid filters.
4. **Disputes** (`/admin/disputes` → `/admin/orders/:id`):
   - The admin sees the verbatim buyer statement (vendors only see a softened version), the tone flag and the full communication log.
   - Resolution options: release to the vendor, refund the buyer, split by percentage, or resume production (reprint).
5. **Escrow** (`/admin/orders`): funds held, released and refunded across all orders.
6. **Analytics** (`/admin/analytics`): market intelligence, with every chart switchable to a table and a CSV export.
7. **Users** (`/admin/users`): suspend or reactivate accounts. Suspension signs the user out immediately.

Charts (`components/charts`) follow a validated light palette: blue `#2a78d6`, then orange `#eb6834` for a second series. They use one y-axis, have hover tooltips and include a table view for accessibility.

## 3D garment models

`public/models/crew-neck.glb`, `polo.glb` and `hoodie.glb` are generated by this project from the same garment outlines the 2D preview uses (`src/utils/garmentGeometry.js`), so the texture atlas lines up exactly with the 2D views: the left half of the texture is the front view and the right half is the back view. They are committed, so a normal build needs nothing extra. After changing a garment outline, regenerate and check them:

```bash
npm run build:models
node scripts/check-garment-models.mjs
```

The 3D viewer (`three`, `@react-three/fiber`, `@react-three/drei`) is lazy-loaded, so it only downloads when someone opens the 3D view.

## Deployment

`vercel.json` and `public/_redirects` provide the SPA fallback. Set `VITE_API_URL` at build time. See [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
