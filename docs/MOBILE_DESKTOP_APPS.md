# CustomT on mobile and desktop

CustomT ships as **one React code base** for the web, an installable app (PWA), and, in step 2, an Android APK. Every platform uses the same backend, auctions, escrow, O2O PIN and design studio, so there is nothing to keep in sync.

| Platform | How | Status |
|---|---|---|
| Android (Chrome, Edge, Samsung Internet) | Install from the browser (PWA) | ✅ Step 1 |
| iPhone / iPad (Safari) | Share → **Add to Home Screen** (PWA) | ✅ Step 1 |
| Windows, macOS, ChromeOS, Linux (Chrome / Edge) | Install icon in the address bar, or **Install CustomT app** in the user menu | ✅ Step 1 |
| Android app (APK) | Capacitor wrapper, built by GitHub Actions | ✅ Step 2 |

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

## Step 2: Android app (APK)

The same production build, wrapped by **Capacitor 8** into a native Android app (`frontend/android`, app id `lk.customt.app`, Android 7.0+). It uses the same live API, auctions, escrow and design studio as the website.

### Get the APK
1. **Every push to `main`** that touches `frontend/` runs **GitHub Actions → "Android APK"**, which:
   - builds the APK;
   - publishes it on the **`android-latest` pre-release:** GitHub → *Releases* → **Android app (latest)** → `CustomT-1.0.<run>-debug.apk`.
2. **Install:** open that link on the phone, download the APK, tap it and allow **Install unknown apps** for the browser when Android asks.
3. **Updates:** the debug APK is signed with a new key on every build, so **uninstall the old CustomT first**. To install updates in place, add a signing key (below).

Pull requests also build the APK; it is attached to the workflow run as an artifact.

### Optional: your own signing key (updates install in place, needed for Google Play later)
1. Create a key once on your computer:
   ```
   keytool -genkeypair -v -keystore customt.keystore -alias customt -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Keep `customt.keystore` and its passwords safe. **Losing it means you can never update the app.**
3. In GitHub → *Settings → Secrets and variables → Actions*, add:
   - `ANDROID_KEYSTORE_BASE64` (the output of `base64 -w0 customt.keystore`);
   - `ANDROID_KEYSTORE_PASSWORD`;
   - `ANDROID_KEY_ALIAS` (`customt`);
   - `ANDROID_KEY_PASSWORD`.
4. The workflow then also builds `CustomT-1.0.<run>.apk`, a release APK signed with that key.

### What is different inside the app
- **Built with `vite build --mode android`** (`frontend/.env.android`):
  - the API address is the live Render API;
  - there is no service worker, because every file is already inside the APK (updates come with a new APK).
- **Native touches** (`frontend/src/native/platform.js`):
  - the Android **back button** goes back through pages and closes the app on the first one;
  - the status bar is white with dark icons;
  - the launcher icon and splash screen are CustomT's (`frontend/assets/` → `npx @capacitor/assets generate --android`).
- **PDF receipts** open Android's **share / save sheet** (Save to Files, Drive, WhatsApp, e-mail), because a WebView cannot download files like a browser.
- **Facebook Login is hidden in the app.** Facebook's sign-in page would return to the browser, not to the app. Users sign in with e-mail; an account created with Facebook can add a password on the website's *Account* page. (A future step can add an Android App Link for Facebook.)
- **The backend allows the app's origin `https://localhost`** in CORS and Socket.IO (`NATIVE_APP_ORIGINS`, default `https://localhost`).

### Build it yourself (optional)
You need Node 22, JDK 21 and the Android SDK (Android Studio installs it). Then:
```
cd frontend
npm run build:android
npm run android:apk
```
The first command builds the web app and copies it into `android/`. The second builds `android/app/build/outputs/apk/debug/app-debug.apk`. You can also open `frontend/android` in Android Studio and press *Run*.
