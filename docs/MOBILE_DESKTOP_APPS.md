# CustomT on mobile and desktop

CustomT ships as **one React code base** for the web, an installable app (PWA), and, in step 2, an Android APK. Every platform uses the same backend, auctions, escrow, O2O PIN and design studio, so there is nothing to keep in sync.

| Platform | How | Status |
|---|---|---|
| Android (Chrome, Edge, Samsung Internet) | Install from the browser (PWA) | ✅ Step 1 |
| iPhone / iPad (Safari) | Share → **Add to Home Screen** (PWA) | ✅ Step 1 |
| Windows, macOS, ChromeOS, Linux (Chrome / Edge) | Install icon in the address bar, or **Install CustomT app** in the user menu | ✅ Step 1 |
| Android APK (sideload for demos) | Capacitor wrapper, built by GitHub Actions | ⏳ Step 2 |

## Step 1: installable app (PWA)

### What the user gets
- **An app icon** on the home screen, Start menu or Dock. The app opens **full screen** without the browser bar.
- **Shortcuts:** long-press the icon (Android) or right-click it (Windows/macOS) for *Design & launch*, *Discover* and *My orders*.
- **Fast, offline start.** The app shell is stored on the device, so CustomT opens instantly and works without a connection for designing (drafts are saved on the device).
  - Auctions, payments, chat and uploads need a connection.
  - An amber banner says so when the device goes offline.
- **Safe updates.** When a new version is deployed, a card offers **Reload**. The app never reloads by itself, so a half-finished bid or form is not lost. Installed apps check for updates every hour.

### How to install
- **Android:** open https://customt.vercel.app in Chrome, then tap **Install app** (landing page or user menu), or use the browser's ⋮ menu → *Install app*.
- **iPhone/iPad:** open the site in **Safari** and tap **Install the app**. The app shows the three steps: Share → *Add to Home Screen* → *Add*.
- **Windows / macOS:** in Chrome or Edge, click the install icon in the address bar, or choose **Install CustomT app** in the user menu.

### How it is built
- **`vite-plugin-pwa` (Workbox)** generates `manifest.webmanifest` and `sw.js` at build time (`frontend/vite.config.js`).
- **Precache:** the app shell (HTML, CSS, main JS, icons), about **840 KB**. Large on-demand chunks are **not** in the install download:
  - the 3D viewer (three.js, about 950 KB);
  - the PDF-receipt libraries (about 600 KB).
- **Runtime cache:**
  - those chunks and the 3D garment models are cached the first time they are used (*cache first*);
  - hashed files never change, so these caches are safe.
- **Never cached:** the API, uploads and Socket.IO are on another origin (`customt-api.onrender.com`) and always go to the network. Prices, bids and escrow states are never stale.
- **`frontend/src/context/PwaContext.jsx`** handles registration, the update card, the install button and iPhone instructions, and the offline banner.
- **`vercel.json`** serves `sw.js` and the manifest with `Cache-Control: no-cache`, so updates are picked up. The existing CSP already allows the worker (`worker-src 'self'`).
- **Icons** (`frontend/public/icons/`) are rendered from the CustomT logo: 192/512 px, a 512 px *maskable* icon for Android's adaptive shapes, and a 180 px Apple touch icon.

## Step 2: Android APK (planned)
- **Capacitor** wraps the same production build in a native Android app (`frontend/android`).
- **GitHub Actions** builds a **debug-signed APK** on every push to `main` and attaches it as a downloadable artifact. No Android Studio is needed on your computer.
- **Install** the APK on any Android phone (allow *Install unknown apps*) for demos and the viva. Publishing on Google Play later needs a developer account (US$25 once) and a release signing key.
- **Things to handle in that step:**
  - the API's CORS allow-list must include the app's origin (`https://localhost` in Capacitor);
  - Facebook Login must return to the app (Android App Link or custom scheme);
  - the status-bar colour and the back button need native handling.
