# CustomT: Unified Registration, Facebook Login and KYB Vendor Onboarding

**Architecture proposal for review. No code changes have been made.**

## 0. Summary

| Today | Proposed |
|---|---|
| Users pick "buyer" or "vendor" at sign-up. Vendors type company details and wait for verification. | Everyone signs up as a **buyer**, with e-mail and password or **Facebook**. |
| An admin verifies a vendor from the typed details; there is no evidence. | A buyer applies to become a vendor with a **KYB application** that has **4 mandatory document types**: BR, NIC, utility bill and past invoices. |
| Files go to `backend/uploads` on Render's disk and are served publicly at `/uploads/...`. | KYB documents go to a **private object store** (S3 or Cloudflare R2), encrypted, never public, and are viewable only by admins through an audited endpoint. |
| `role` is chosen by the user. | `role` changes only when an admin approves. The application moves `DRAFT → PENDING_APPROVAL → APPROVED / CHANGES_REQUESTED / REJECTED`. |

The existing security work stays intact:
- **PERA lock.** `isVerified` and `licenseExpiryDate` keep driving `qualificationIssues()`; approval sets them.
- **Self-dealing check.** It still compares phone numbers, and gets stronger with a hashed NIC.
- **Escrow, O2O, contact filtering and CSP** are unchanged.

---

## 1. Database schema

### 1.1 Design decision: keep one `role`, add a vendor status

Two options were considered:

| | **A. Single `role` (recommended)** | B. Multi-role account (`roles: ['buyer','vendor']` plus an "active mode") |
|---|---|---|
| Model | `role` stays `buyer` / `vendor` / `admin`. Approval changes `buyer` to `vendor`. | One account can buy and sell, like Alibaba, switching mode in the UI. |
| Impact on the code | Small. `authorize()`, socket role rooms, navigation, `orderView` and the PERA lock all read `user.role` and keep working. | Large. Every `user.role` check (about 60 places in routes, services and sockets) needs a "current mode" concept. |
| Self-dealing | A vendor can't buy as the same account. | Must also block an account from accepting its own bid. |
| Trade-off | An approved vendor who also wants to buy needs a second buyer account. | Closer to the marketplace giants, but a much bigger change. |

**Recommendation: A** for this project. The schema below keeps B possible later: the KYB data lives in its own collection, so adding a `roles` array afterwards is a contained migration.

### 1.2 `User` model changes

```js
// New / changed fields only (sketch for review, not final code)
{
  // ── Identity ─────────────────────────────────────────────
  email:        { type: String, unique: true, sparse: true, lowercase: true, ... },  // sparse: a Facebook user may have no e-mail yet
  emailVerified:{ type: Boolean, default: false },
  passwordHash: { type: String, select: false },          // now OPTIONAL: Facebook-only accounts have none
  phone:        { type: String, ... },                    // now OPTIONAL at sign-up; required (and OTP-verified) before posting an RFQ or applying for KYB
  phoneVerifiedAt: { type: Date },

  // ── Linked social logins ─────────────────────────────────
  oauth: {
    facebook: {
      id:       { type: String },                         // app-scoped user id (ASID)
      linkedAt: { type: Date },
      // No Facebook access token is stored: it is used once at login and thrown away.
    },
  },

  // ── Role and vendor onboarding ───────────────────────────
  role: { type: String, enum: ['buyer', 'vendor', 'admin'], default: 'buyer', immutable: false },  // changed ONLY by the admin-approval service
  vendorStatus: {
    type: String,
    enum: ['NONE', 'DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED'],
    default: 'NONE',
    index: true,
  },
  currentApplicationId: { type: ObjectId, ref: 'VendorApplication' },
  kybApprovedAt:  { type: Date },
  kybApprovedBy:  { type: ObjectId, ref: 'User' },
  reapplyAfter:   { type: Date },                         // cooling-off period after a rejection

  // Vendor profile fields that already exist (companyName, businessRegNo, capabilities,
  // maxCapacity, licenseExpiryDate, isVerified) are KEPT, and are copied from the approved
  // application by the approval service. They are never set by the user directly.
}

// Indexes
userSchema.index({ 'oauth.facebook.id': 1 }, { unique: true, sparse: true });
userSchema.index({ businessRegNo: 1 }, { unique: true, sparse: true });      // one vendor account per business
```

Why the KYB data is **not** embedded in `User`:
- `User` documents are loaded on **every request** (`protect`) and serialised in many responses. Document metadata there could leak through a careless `toJSON`.
- A business may apply more than once (rejected, then resubmitted). Each submission and each admin decision must be kept for audit.

### 1.3 New `VendorApplication` collection

```js
{
  userId:    { type: ObjectId, ref: 'User', required: true, index: true },
  status:    { enum: ['DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'], index: true },
  submissionCount: Number,                               // 1, 2, 3... (resubmissions after CHANGES_REQUESTED)

  business: {
    legalName:        String,    // contact-filtered like every other display text
    tradingName:      String,
    businessRegNo:    String,    // upper-cased, unique among APPROVED applications
    registeredAddress:{ line1, line2, city, district, postalCode },
    capabilities:     [PRINT_TYPES],
    maxCapacity:      Number,
    licenseExpiryDate:Date,
  },

  owner: {
    fullName:   String,
    nicLast4:   String,          // shown to admins for matching against the document
    nicHash:    String,          // HMAC-SHA256(NIC, server key): detects one person behind many vendor accounts; the full NIC is never stored in plain text
  },

  documents: [{                  // references only, never public URLs
    _id:          ObjectId,
    type:         { enum: ['BR_COPY', 'NIC_FRONT', 'NIC_BACK', 'UTILITY_BILL', 'PAST_INVOICE'] },
    storageKey:   String,        // e.g. kyb/<userId>/<applicationId>/PAST_INVOICE/<uuid>.pdf
    originalName: String,        // sanitised; for display only
    mimeType:     { enum: ['application/pdf', 'image/jpeg', 'image/png'] },
    sizeBytes:    Number,
    sha256:       String,        // integrity, and detects the same file reused across applications
    issuedOn:     Date,          // user-entered: invoice date, utility bill month
    review:       { status: { enum: ['PENDING', 'ACCEPTED', 'REJECTED'] }, reason: String, reviewedBy: ObjectId, reviewedAt: Date },
    uploadedAt:   Date,
  }],

  submittedAt: Date,
  decision: { outcome: { enum: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] }, notes: String, decidedBy: ObjectId, decidedAt: Date },
  history: [{ status, actorId, actorRole, note, at }],   // append-only trail
  consentAt: Date,                                       // applicant agreed to the KYB privacy notice
}
```

**Validation rules for submission** (pre-validate hook plus the service):

| Document | Rule |
|---|---|
| BR copy | Exactly 1. PDF or image. |
| NIC | Front and back (2 files), or a single PDF with both sides. |
| Utility bill | 1 file, dated within the last **3 months**, address matching `registeredAddress` (checked by the admin). |
| **Past invoices** | **At least 3, at most 10**, dated within the last **12 months**, spread across **at least 2 different months** (shows ongoing trading, not a one-off). |
| All files | PDF / JPEG / PNG only, verified by magic bytes; at most 8 MB each and 40 MB per application. |

The invoice thresholds are a policy suggestion; see the open questions in section 4.

### 1.4 `KybAccessLog` collection (audit)

Each time an admin opens a document, the system stores `{ adminId, applicationId, documentId, action: 'VIEW', ip, userAgent, at }`. Entries are never deleted, so "who viewed this NIC copy, and when?" can always be answered.

---

## 2. Tech stack and storage security

### 2.1 Why the current upload path can't hold KYB documents

- `express.static('/uploads')` serves every uploaded file **publicly** to anyone with the URL. This is fine for design images, but unacceptable for NIC copies.
- Render's free plan has an **ephemeral disk**: files disappear on every redeploy.
- MongoDB GridFS on the free Atlas M0 tier (512 MB in total) would fill up after a few dozen applications.

### 2.2 Recommended: private S3-compatible object storage

| Option | Fit | Cost for this project |
|---|---|---|
| **AWS S3** (recommended for the dissertation) | Industry standard. Block Public Access, SSE-KMS encryption, IAM least privilege, presigned URLs, lifecycle rules. | Free tier: 5 GB for 12 months. |
| **Cloudflare R2** (recommended if cost matters) | Same S3 API, so the same code. No egress fees. | Free tier: 10 GB. |
| Cloudinary (`type: authenticated`) | Good for images; PDFs work but its strengths (transformations, CDN) aren't needed. Signed delivery URLs. | Free tier is credit-based. |

**Recommendation: S3, or R2 if cost matters, accessed with `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.** Both work through the same code.

**Bucket configuration:**
- One dedicated bucket, e.g. `customt-kyb-prod`, separate from any public asset bucket.
- **Block all public access** at both the account and bucket level. No bucket policy grants anonymous reads.
- **Server-side encryption** on by default (SSE-S3 or SSE-KMS).
- A separate IAM user just for the API, with only `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::customt-kyb-prod/kyb/*`. Its keys live in Render's environment settings, never in Git.
- A **lifecycle rule** that deletes `kyb/` objects of rejected or withdrawn applications after 180 days. The application service also deletes them explicitly.
- Optional: versioning plus Object Lock, if the reviewers want tamper-evident retention.

### 2.3 Upload path: through the API, not directly from the browser

```
Browser ──multipart/form-data──► Express (Multer memoryStorage) ──validate──► S3 PutObject ──► Mongo: storageKey only
```

Uploads go through the backend rather than with presigned PUT URLs from the browser, because the server must **inspect** every byte before it is stored:
1. **Multer `memoryStorage`** with limits: `fileSize: 8 MB`, `files: 15`, named fields per document type. Nothing touches Render's disk.
2. **Magic-byte check** (`%PDF-`, `FFD8FF`, PNG signature), extending the check added in the security audit. The browser's `Content-Type` is ignored.
3. **PDF hardening:** reject encrypted PDFs, and PDFs containing JavaScript or embedded files (`/JS`, `/JavaScript`, `/Launch`, `/EmbeddedFile`). They have no place in a BR copy.
4. **Image hygiene:** re-encode JPEG and PNG with `sharp`. This strips EXIF data (including GPS location from phone photos) and neutralises polyglot files.
5. **Optional virus scan:** ClamAV in a sidecar or a cloud scanning service, if the budget allows. For the dissertation, document it as a production recommendation.
6. **Server-generated object key:** `kyb/<userId>/<applicationId>/<TYPE>/<uuidv4>.<ext>`. The user's filename never becomes a path, so path traversal is impossible.
7. **`PutObject`** with `ContentType` set to the verified type, `ContentDisposition: attachment`, and encryption on.
8. Only `storageKey`, `sha256`, size and type are saved in MongoDB.

Per-user rate limiting applies (e.g. 30 uploads per hour), and draft documents are deleted from S3 when replaced.

### 2.4 Viewing: admin-only, short-lived and audited

`GET /api/admin/vendor-applications/:id/documents/:docId`
1. `protect` then `authorize('admin')`. Reviewers could later be limited to a `kybReviewer` permission.
2. Write a `KybAccessLog` entry.
3. Either:
   - **(a) Stream the object through the API** (recommended): `GetObject`, then pipe to the response with `Cache-Control: no-store`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and a `Content-Security-Policy: sandbox` header. The admin UI fetches it with the bearer token, turns it into a `blob:` URL and shows it in an `<iframe>` or `<img>`. The bucket host never reaches the browser, and the existing frontend CSP needs only `frame-src blob:` added.
   - **(b) Return a presigned GET URL** with a **60-second** expiry. This is simpler, but the URL works for anyone who has it during that minute, and the CSP must allow the bucket host.

Applicants can see the **names and review status** of their own documents, but can't download them again (not needed, and less exposure). Buyers, vendors and the public have **no route** to these files at all.

### 2.5 Facebook Login (OAuth 2.0)

**Use the server-side Authorization Code flow, not the Facebook JavaScript SDK.**
- The app secret stays on the server and the access token never reaches the browser.
- No third-party script is loaded into the page, so the strict CSP from the security audit stays strict.

Facebook setup:
1. Create a **Consumer** app on developers.facebook.com and add the Facebook Login product.
2. Set the valid OAuth redirect URI to exactly `https://customt-api.onrender.com/api/auth/facebook/callback`.
3. Ask only for `public_profile` and `email`. These are standard permissions; no extended permissions are needed.
4. Before switching the app to **Live** mode, it needs a **Privacy Policy URL** and a **Data Deletion callback URL or instructions page**.
5. Store `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` in Render's environment settings. Pin the Graph API version in configuration, e.g. `FACEBOOK_GRAPH_VERSION=v21.0`.

Server details:
- **CSRF protection:** a random `state` value stored in a short-lived, signed, `HttpOnly; Secure; SameSite=Lax` cookie and compared on callback.
- Exchange the code at `graph.facebook.com/<version>/oauth/access_token` (server to server, with the app secret).
- Fetch `/me?fields=id,name,email` with an `appsecret_proof` (HMAC of the token with the app secret).
- Discard the Facebook token after use.
- **Handing off to the React app:** the API must not put the CustomT JWT in the redirect URL, where it would end up in browser history and logs. Instead:
  1. The API creates a **one-time login code** (random, stored hashed, valid for 60 seconds).
  2. It redirects to `https://customt.vercel.app/auth/callback?code=…`.
  3. The React app immediately calls `POST /api/auth/exchange { code }` and receives the normal JWT.

**Account matching rules** (they prevent account takeover):

| Situation | Behaviour |
|---|---|
| The Facebook id is already linked | Log in. |
| New Facebook id, and the e-mail is new or missing | Create a **buyer**. If Facebook gave no e-mail (accounts registered with a phone), ask for one and verify it. |
| New Facebook id, but the e-mail belongs to an existing password account | **Don't auto-link.** Ask the user to log in with their password once, then link from *Account → Linked logins*. Auto-linking by e-mail is a well-known takeover route. |
| Facebook-only account wants a password | Allowed through *set password*, using the existing reset-link mechanism. |
| Unlinking Facebook | Allowed only if a password exists, so the user can't lock themselves out. |

---

## 3. Architecture flow

### 3.1 Registration and Facebook login

```
[React] Register page
   ├─ e-mail + password ─► POST /api/auth/register { name, email, password }   (role is no longer accepted; always buyer)
   │                         └─► User{role:'buyer', vendorStatus:'NONE'} ─► JWT
   └─ "Continue with Facebook" ─► GET /api/auth/facebook   (full-page navigation)
                                   ├─ set signed state cookie
                                   └─ 302 ─► facebook.com/dialog/oauth?client_id&redirect_uri&state&scope=public_profile,email
        user consents on Facebook
        Facebook ─► GET /api/auth/facebook/callback?code&state
                     ├─ check state cookie
                     ├─ code ─► access_token (server to server) ─► /me
                     ├─ find or create the user (matching rules in 2.5)
                     ├─ create a one-time login code (60 s)
                     └─ 302 ─► https://customt.vercel.app/auth/callback?code=…
[React] /auth/callback ─► POST /api/auth/exchange { code } ─► { token, user } ─► stored as today ─► /feed
```

Removing `role: 'vendor'` from `/register` closes the old path where anyone could start as an unverified vendor.

### 3.2 Applying to become a vendor (buyer side)

New buyer dashboard page: **"Sell on CustomT"** at `/buyer/become-vendor`.

| Step | React | Express | Data |
|---|---|---|---|
| 1. Eligibility | Shows the requirements and the 4 document types. Requires a verified phone, plus verified e-mail if the user signed up with Facebook. | `GET /api/kyb/application`: current application or none | none |
| 2. Business details | Form: legal name, BR number, address, capabilities, capacity, licence expiry, owner name, NIC number | `PUT /api/kyb/application` (creates or updates the DRAFT): validated, contact-filtered, BR uniqueness checked, NIC turned into `nicLast4` plus `nicHash` | `VendorApplication{status:'DRAFT'}` and `User.vendorStatus='DRAFT'` |
| 3. Documents | 4 upload panels with progress, file type and size hints, and a date field for invoices and the bill | `POST /api/kyb/application/documents` (multipart, field `type`): the upload pipeline in 2.3 | `documents[]` entries |
| 4. Review and consent | Summary, checklist, privacy-notice checkbox | `POST /api/kyb/application/submit`: server re-checks **all** rules from 1.3 | `status: PENDING_APPROVAL`, `submittedAt`, `history[]`, `User.vendorStatus='PENDING_APPROVAL'` |
| 5. Waiting | Status page: "Under review". Documents are locked. | Socket event `admin:kyb:new` to admins, plus an e-mail to the applicant | none |

While the status is `PENDING_APPROVAL` the application is **read-only**. Only `withdraw` is allowed.

### 3.3 Admin review

The admin panel's *Vendors* page becomes **KYB Applications**: a queue sorted by `submittedAt`, with filters by status.

```
GET  /api/admin/vendor-applications?status=PENDING_APPROVAL
GET  /api/admin/vendor-applications/:id                   (details + document list, no URLs)
GET  /api/admin/vendor-applications/:id/documents/:docId  (streamed, logged; see 2.4)
POST /api/admin/vendor-applications/:id/documents/:docId/review { status, reason }
POST /api/admin/vendor-applications/:id/decision { outcome, notes, licenseExpiryDate? }
```

The reviewer sees each document side by side with the typed business details. They mark each document Accepted or Rejected with a reason, then decide:

| Outcome | Effect (one service function, version-checked like orders) |
|---|---|
| **APPROVED** | Requires every document Accepted. Application `APPROVED`. On the `User`: `role='vendor'`, `vendorStatus='APPROVED'`, business fields copied from the application, `isVerified=true`, `verifiedAt`, `verifiedBy`, `kybApprovedAt`. **Disconnect the user's sockets** so the next connection joins the `role_vendor` room. Send `vendor:verification` socket event and an e-mail. |
| **CHANGES_REQUESTED** | Application and `User.vendorStatus` become `CHANGES_REQUESTED`. The rejected documents and reasons are shown to the applicant, who replaces those files and resubmits (`submissionCount += 1`). |
| **REJECTED** | `REJECTED`, `User.reapplyAfter = now + 30 days`. Documents are scheduled for deletion. |

**Why role changes are safe:**
- The JWT carries `role`, but `protect` already reloads the user from the database on every request and uses the database role. A role change therefore applies immediately to REST calls; no new token is needed.
- Socket.IO captures the role at connection time. That is why approval disconnects the user's sockets.
- The frontend refreshes `/auth/me` on the `vendor:verification` event and switches to the vendor navigation.

### 3.4 After approval (existing systems unchanged)

- **PERA lock:** `qualificationIssues()` still checks `isVerified` and the licence date. Licence expiry still locks the vendor out automatically. Admin suspension sets `vendorStatus='SUSPENDED'` and `isVerified=false`.
- **Self-dealing:** acceptance and Direct-RFQ checks also compare `nicHash`. A buyer whose NIC matches the vendor's owner can't award that vendor.
- **Profile changes** that need re-verification (new capabilities, more capacity, licence, company name) open a small **amendment application** (step 3 with only the relevant documents) instead of silently clearing `isVerified`.

### 3.5 Migrating existing accounts

1. Existing vendors: `vendorStatus = isVerified ? 'APPROVED' : 'PENDING_APPROVAL'`. Create a `VendorApplication{status:'APPROVED', note:'Grandfathered before KYB'}` so the audit trail is complete. Optionally ask them to upload documents within N days.
2. Existing buyers: `vendorStatus='NONE'`.
3. Demo seed: creates approved vendors with a placeholder application. The seed refuses to run in production with default passwords (already in place).
4. A one-off migration script with a dry-run mode, run from the Render shell.

### 3.6 New configuration (Render environment, never in Git)

`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_GRAPH_VERSION`, `KYB_S3_BUCKET`, `KYB_S3_REGION`, `KYB_S3_ENDPOINT` (for R2), `KYB_S3_ACCESS_KEY_ID`, `KYB_S3_SECRET_ACCESS_KEY`, `KYB_HASH_KEY` (for the NIC HMAC).

New dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (only for option b) and `sharp`. No Passport.js is needed: the OAuth flow is about 120 lines with the built-in `fetch`, which is easier to audit and explain in the dissertation.

### 3.7 Testing plan

- **Unit tests:**
  - application validation (every missing or extra document rule, invoice date spread);
  - magic-byte and PDF-script rejection;
  - Facebook state checking;
  - the one-time code (expiry, single use).
- **End-to-end tests** (CI, MongoDB 7, with S3 replaced by an in-memory fake through a small storage interface):
  - register, then apply, upload, submit, request changes, resubmit, approve;
  - the new vendor can bid, and the role switch is visible to sockets;
  - a non-admin gets 403 on document routes;
  - document access is logged;
  - a rejected applicant can't reapply within 30 days.
- **Facebook:** the token exchange is mocked in CI. A manual test checklist covers the real Facebook test users that Facebook provides for development.

### 3.8 Suggested delivery steps (after this proposal is approved)

1. Storage layer, the `VendorApplication` and `KybAccessLog` models, the KYB API and the admin review API, with tests.
2. Applicant UI (the "Sell on CustomT" wizard) and admin review UI, plus migration of existing vendors.
3. Facebook Login (needs the Facebook app to be created first), phone/e-mail verification, and the linked-logins settings.

---

## 4. Decisions needed before coding

1. **Role model:** A (single role, recommended) or B (one account for both buying and selling)?
2. **Storage provider:** AWS S3 or Cloudflare R2? Someone must create the account and bucket; I can give exact click-by-click steps.
3. **Invoice policy:** are *3 to 10 invoices from the last 12 months, across at least 2 months* right for Sri Lankan SMEs, or should it be stricter or looser?
4. **Existing vendors:** grandfather them in, or require documents within a deadline?
5. **Phone verification:** is SMS OTP in scope? It needs a paid SMS gateway such as Notify.lk or Twilio. Without it, phone numbers stay self-declared and the self-dealing check is weaker; the NIC hash compensates.
6. **Document retention:** how long to keep documents of approved vendors (e.g. as long as the account is active plus a fixed period), and of rejected applications (proposed: 180 days)? Check against Sri Lanka's Personal Data Protection Act No. 9 of 2022.
