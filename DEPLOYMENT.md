# Deploying CustomT

CustomT has three parts. Each goes to a managed service with a free or low-cost tier.

| Part | Service | Why |
|---|---|---|
| Database | **MongoDB Atlas** (M0 free) | Managed MongoDB, as the project specifies |
| API + Socket.IO | **Render** web service | Long-lived Node process with native WebSocket support |
| React frontend | **Vercel** or **Netlify** | Static hosting for the Vite build |

> Don't host the API on a serverless platform (Vercel functions, Netlify functions, AWS Lambda). The reverse-auction engine needs **persistent WebSocket connections** and the **auction scheduler** (`setInterval`). Both need a long-running process.

---

## 1. MongoDB Atlas

1. Create a free account at <https://www.mongodb.com/cloud/atlas> and an **M0** cluster. Pick the region closest to your API host (for Sri Lanka, AWS Mumbai `ap-south-1`).
2. **Database Access → Add user**: choose username/password auth and the *Read and write to any database* role.
3. **Network Access → Add IP**: Render's outbound IPs change, so use `0.0.0.0/0` (allow from anywhere). The strong password and TLS still protect the cluster. On a paid Render plan you can allow-list Render's static outbound IPs instead.
4. **Connect → Drivers** and copy the connection string. Insert the password and add the database name `customt`:
   ```
   mongodb+srv://customt_app:<password>@cluster0.xxxxx.mongodb.net/customt?retryWrites=true&w=majority
   ```
   URL-encode special characters in the password (`@` → `%40`).

## 2. Push the code to GitHub

```bash
cd customt
git init
git add .
git commit -m "CustomT: marketplace, reverse auction & escrow platform"
git branch -M main
git remote add origin https://github.com/<you>/customt.git
git push -u origin main
```

`.env` files are git-ignored. Never commit secrets.

## 3. API on Render

**Option A: Blueprint (recommended).** Render → *New → Blueprint* → select the repo. `render.yaml` at the repository root configures everything. When prompted, fill in:

| Variable | Value |
|---|---|
| `MONGO_URI` | the Atlas string from step 1 |
| `CLIENT_URL` | your frontend URL from step 4, e.g. `https://customt.vercel.app` (no trailing slash; comma-separate several) |
| `PUBLIC_API_URL` | the Render URL, e.g. `https://customt-api.onrender.com` |

`JWT_SECRET` is generated automatically. The blueprint uses Render's **free** plan, with no persistent disk, so uploaded logos are lost on each redeploy (see *Uploads* below). To stay always on, change `plan: free` to `plan: starter`.

**Option B: manual web service.** *New → Web Service*. Use these settings: root directory `backend`, build command `npm ci --omit=dev`, start command `npm start`, health check path `/api/health`. Then add the environment variables from `backend/.env.example`.

**Create the admin account.** Open the service's *Shell* tab (or run locally with the production `MONGO_URI`):

```bash
npm run seed:admin                       # admin only: production
```
```bash
npm run seed                             # admin + demo buyer/vendors: demo/viva environments only
```

Set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` first, and change the password after the first login (*Account → Change password*).

**Verify:** `https://<api>/api/health` returns `{"success":true,"db":"connected"}`.

## 4. Frontend on Vercel (or Netlify)

**Vercel:** *Add New → Project* → import the repo. Set **Root Directory** to `frontend` (the framework is detected as Vite). Add this environment variable:

```
VITE_API_URL = https://customt-api.onrender.com
```

Deploy. `frontend/vercel.json` rewrites every path to `index.html`, so deep links such as `/buyer/rfqs/…` work after a refresh.

**Netlify:** set base directory `frontend`, build command `npm run build` and publish directory `frontend/dist`, plus the same `VITE_API_URL`. `public/_redirects` provides the SPA fallback.

> `VITE_*` variables are compiled into the bundle at **build time**. After changing `VITE_API_URL`, redeploy the frontend.

Finally, make sure the API's `CLIENT_URL` exactly matches the frontend origin (scheme + host, no path). Redeploy the API if you changed it. A mismatch shows up as CORS errors in the browser and an "Offline" badge in the navbar.

## 5. Post-deploy smoke test (5 minutes)

1. Log in as the admin and open **Vendors**. Verify a vendor; with the demo seed, verify `vendor4`.
2. In a second browser profile, log in as the **buyer**, design an RFQ and launch it.
3. In a third profile, log in as a matching **vendor**. The RFQ appears in *Live RFQs* without a refresh. Place a bid.
4. The buyer's leaderboard updates live; the vendor sees only *Rank #n of m*.
5. As the buyer, accept the bid and pay with test card `4242 4242 4242 4242`. As the vendor, advance production; the wallet shows the 30% advance.
6. Mark the order ready for inspection. The buyer sees the PIN, and the vendor enters it, which releases the 70%. The buyer then rates the vendor and the trust score changes.
7. Optionally raise a dispute and resolve it from **Admin → Disputes**.

For a live demo, set `AUCTION_DURATION_MINUTES=5` on the API so expiry and soft-close (the 2-minute window extends the auction by 5 minutes) are visible quickly.

## Production notes

| Topic | Guidance |
|---|---|
| **Scaling** | Run **one** API instance. Bid ranking and soft-close are serialized with an in-process lock. To scale out, add Redis: `@socket.io/redis-adapter` for rooms and a Redis lock (e.g. Redlock) around `auctionMutex`. |
| **Uploads** | Logos are stored on local disk at `backend/uploads`. Render's disk is ephemeral unless you attach a persistent disk (paid). For free hosting, swap `middleware/upload.js` to Cloudinary or S3 and return the CDN URL; the rest of the system already stores only the URL. |
| **Cold starts** | Render's free plan sleeps after 15 minutes idle; the first request takes about 30–60 seconds. Open `/api/health` a minute before a demo. |
| **Secrets** | `JWT_SECRET` must be 32+ characters (the server refuses to start otherwise). Rotating it signs everyone out. |
| **Payments** | The gateway is a **mock** for research purposes. A real deployment would integrate PayHere / Stripe with webhook-confirmed escrow. Keep the same `fundEscrow` state transition. |
| **Backups** | Atlas M0 has no automated backups. Use `mongodump` before demos, or upgrade to M10+ for continuous backups. |
| **Monitoring** | Point Render's health check or UptimeRobot at `/api/health`. Logs use `morgan` combined format in production. |
| **Rate limits** | 600 req/min per IP on `/api`, 50 per 15 minutes on auth routes (`express-rate-limit`). Adjust them in `server.js` / `routes/authRoutes.js` behind a CDN. |

## Local development (recap)

```bash
cd backend && cp .env.example .env && npm install && npm run seed && npm run dev
```
```bash
cd frontend && cp .env.example .env && npm install && npm run dev
```

The API runs on `http://localhost:5000` and the web app on `http://localhost:5173`.
