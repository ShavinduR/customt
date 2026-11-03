# CustomT

**A Centralized E-commerce Marketplace and Reverse Auction Platform for Custom Apparel Procurement**
BICT Honours final-year research project · MERN stack (MongoDB Atlas, Express, React, Node.js) + Socket.IO

Buyers design custom T-shirts visually. The design becomes a locked technical RFQ, and a 24-hour real-time reverse auction opens to **prequalified** SME printers. Bids are ranked by a multi-attribute score, and payment flows through a split **escrow** that releases the final 70% only after an **Online-to-Offline (O2O)** physical inspection.

```
customt/
├── backend/        Express REST API, Socket.IO auction engine, Mongoose models  → backend/README.md
├── frontend/       React (Vite) + Tailwind web app for buyers, vendors, admins  → frontend/README.md
├── render.yaml     Render blueprint for the API
└── DEPLOYMENT.md   Atlas + Render + Vercel/Netlify deployment guide
```

## Research mechanisms implemented

| Mechanism | Where it lives |
|---|---|
| **PERA prequalification**: qualification lock (verified + valid license), participant lock (capability + capacity), event lock (≥1 eligible vendor before launch) | `backend/models/User.js`, `services/auctionService.js`; admin verification UI; vendor lock screen |
| **CPAPO mitigation**: specs locked once bidding opens | RFQ save + query hooks return 423; UI shows "Specs locked" |
| **Multi-attribute scoring**: `(minPrice/price)·0.5 + (trust/maxTrust)·0.3 + (minLead/lead)·0.2` | `services/scoringEngine.js` (unit-tested) |
| **Rank-based partial visibility**: buyer/admin see the leaderboard; vendors see only "Rank #n of m" | Socket rooms + `buildLeaderboard` / `buildVendorBidView` |
| **Soft-close**: a bid in the last 2 minutes adds 5 minutes | `auctionService.placeBid` |
| **Price-signal diagnostic**: CV > 0.35 with ≥3 bids flags spec ambiguity | `computePriceDiagnostic`; buyer, admin and analytics UI |
| **Split escrow**: 30% on production start, 70% on O2O | `services/orderService.js` |
| **O2O verification**: 6-digit PIN + QR, 5 attempts, buyer-only visibility | Buyer O2O panel; vendor PIN entry + camera QR scan |
| **Trust EWMA**: `0.7·old + 0.3·rating` | `orderService.rateVendor` |
| **E-commerce politeness CRM**: tone screening, softened vendor messages, templated acknowledgements and resolutions | `utils/politenessTemplates.js`; dispute UI |
| **Market intelligence**: GMV, savings vs highest bid, unit price by method, dispute rate, ambiguity watchlist | `GET /api/admin/analytics`; Admin → Analytics |

## Quick start

```bash
cd backend && cp .env.example .env    # set MONGO_URI + JWT_SECRET
npm install && npm run seed && npm run dev
```
```bash
cd frontend && cp .env.example .env && npm install && npm run dev
```

Open <http://localhost:5173>. Demo logins (after `npm run seed`):

| Role | Email | Password |
|---|---|---|
| Admin | admin@customt.lk | Admin@12345 |
| Buyer | buyer@customt.lk | Demo@12345 |
| Vendor (verified) | vendor1@customt.lk · vendor2@… · vendor3@… | Demo@12345 |
| Vendor (pending, shows the PERA lock) | vendor4@customt.lk | Demo@12345 |

Use separate browser profiles (or one incognito window per role) to watch the real-time flow between buyer, vendor and admin.

## Viva demo script (~10 minutes)

1. **PERA:** log in as `vendor4`. *Live RFQs* is locked. As admin, open **Vendors → Review & verify** (checklist + license date). Vendor4's screen unlocks with no refresh.
2. **Module 1:** as the buyer, open **Design & Launch**. Switch to *Polo*, *Embroidery*, front & back, and drag the logo. Fill the size matrix; the MOQ, delivery days and eligible-vendor count update live. Launch, and note the CPAPO lock.
3. **Module 2:** vendors bid from the live feed; re-bid lower with the −2% button. The buyer's leaderboard re-ranks and flashes, while vendors see only their rank. Bid in the last 2 minutes to trigger the soft-close extension. Spread prices widely to trigger the variance warning.
4. **Module 3:** accept a bid, then pay with `4242 4242 4242 4242` (try `4000 0000 0000 0002` for a decline). The vendor advances production (30% released to the wallet), then marks it ready. The buyer reveals the PIN or QR, the vendor enters it, 70% is released, and the buyer rates the vendor (trust score before → after).
5. **Disputes:** on another order, raise a dispute with heated wording. The vendor sees a softened message; the admin sees the verbatim statement, a tone flag and a split-settlement slider.
6. **Analytics:** open **Admin → Analytics**: savings vs highest bid, unit price by print method, and the ambiguity watchlist. Export the CSV.

Set `AUCTION_DURATION_MINUTES=5` in `backend/.env` so auctions close during the demo.

## Testing

```bash
cd backend && npm test
```

The unit tests cover the scoring formula, tie-breaks, the CV diagnostic, the EWMA and the RFQ calculator.

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)**: MongoDB Atlas, the API on Render (WebSockets), the frontend on Vercel/Netlify, the post-deploy smoke test and production notes.
