# CustomT 2.0: product vision

*Ideas drawn from studying BlankBuilder (blankbuilder.app: landing page, editor, guided tour, "What's new" v1–v1.6), adapted to CustomT. We take **patterns** (what works for users), not their branding, wording or visual identity.*

---

## 1. The big idea

BlankBuilder's own footer states its limit: **"We don't print or sell clothing."** It ends with a ZIP of print files and a PDF spec sheet, and the user still has to find a printer, negotiate, pay and hope.

CustomT already does the part BlankBuilder leaves out: printers **compete** for the order, payment sits in **escrow**, and the money is released only after the buyer **inspects the goods** (O2O PIN). What CustomT lacks is the polish and the *production-ready output* of a professional design tool.

> **CustomT 2.0: "Design it. Get it made. Pay only when it's right."**
> One place to go from idea to delivered garments: a professional design studio, files printers can produce from directly, competing quotes, and escrow-protected delivery.

Combining both halves is the thesis contribution: a **closed loop from design to delivery** that neither a mockup tool nor a classic marketplace offers.

| | BlankBuilder | CustomT today | CustomT 2.0 |
|---|---|---|---|
| Design on garment, live 3D | ✅ advanced | ✅ basic | ✅ advanced |
| Real print sizes (cm) | ✅ | ❌ (percentages) | ✅ |
| Print-ready files + spec sheet | ✅ (user downloads) | ❌ | ✅ **attached to the RFQ for printers** |
| Find a printer, get quotes | ❌ | ✅ reverse auction | ✅ |
| Payment protection | ❌ | ✅ escrow + O2O | ✅ |
| Verified suppliers | ❌ | ✅ KYB | ✅ |

---

## 2. What we learned from BlankBuilder (and what it means for us)

| What they do | Why it works | CustomT version |
|---|---|---|
| **Sewing pattern, Split, 3D** view modes | You edit flat and see the result live, side by side | Add **Split view** to the configurator (2D editor beside the live 3D) |
| **Real sizes** ("front 26.2 × 32.7 cm") on the pattern | Printers price and produce by size | Show **cm sizes** for every layer and print area; store them in the RFQ |
| **Print files ZIP**: one 300-DPI PNG per print, named with part and size | Printers can produce without asking questions | **Production pack** generated at launch, released to the winning printer |
| **Spec sheet PDF**: position and size of each print | Removes ambiguity | **Spec sheet** attached to every RFQ, so vendors quote on the same facts. This also reduces the price spread our diagnostic warns about |
| **"Your shirt is a different size?"** scaling | Real garments vary | Per-size print scaling in the spec sheet (S to XXL) |
| **6-step guided tour** with spotlight | New users succeed on the first visit | **CustomT tour**: design, check in 3D, sizes, launch, how escrow protects you |
| **Adaptive 3D quality** (lighter while turning) | Smooth on weak laptops and phones | Adaptive resolution in our 3D viewer; matters for mobile users in Sri Lanka |
| **Undo/redo, magnet snapping, rotate, crop** | Editing feels professional | Undo/redo, rotate, snap to centre lines, show/hide and lock layers |
| **Inside prints** (neck label) | Brands want their own label | New print side **"Inside label"** (affects printer pricing) |
| **Picture checks** ("this may print blurry") | Prevents bad orders | **Print-quality check**: warn when an image is under 150/300 DPI at its printed size |
| **Catalogue renders** for stores | Buyers who sell merch need photos | **3D snapshot** saved with the RFQ and order; later, a share image for the buyer's store |
| **Public "What's new"** with versions | Shows an active, trustworthy product | **Changelog page** from our real releases (also great evidence for the thesis) |
| **Illustrated guide + feedback form** | Self-service help, user voice | **How it works** (buyer and printer tracks) + **Suggest an idea** form read by admins |
| **4 languages** | Reach | **Sinhala and Tamil** alongside English, which suits our market better than their FR/ZH/RU |
| Honest FAQ ("Is this AI? No.") | Builds trust | FAQ on escrow, the PIN, KYB, fees and disputes |

**Things we deliberately won't copy:** cloud GPU rendering and credits, subscription plans, 30 garment models, halftone and vectorise. These belong to a design-software business. CustomT's value is the transaction, so effort goes into production accuracy and trust.

---

## 3. The CustomT 2.0 experience

### Buyer journey
1. **Discover** (feed) → **Design studio** (Split view, guided tour on first visit).
2. Place artwork on front, back, sleeves and **inside label**, with **real cm sizes**, rotation, undo/redo and print-quality warnings.
3. Check in 3D (adaptive quality). Take a **3D snapshot**.
4. Sizes and quantities, then **Launch**. CustomT generates the **production pack**:
   - spec sheet PDF: prints, sizes, positions, colours, fonts, size breakdown, snapshot;
   - print files ZIP: one high-resolution PNG per printed side, named like `front_26.2x32.7cm.png`.
5. Printers see the **spec sheet** and snapshot while bidding, and the **print files only after winning and once escrow is funded**. This protects the buyer's artwork from being taken by losing bidders.
6. Escrow → production → inspection → O2O PIN, as today.

### Printer journey
1. **Sell on CustomT** (KYB), then storefront posts.
2. Quote from a precise spec sheet: fewer clarification messages, fairer comparison.
3. After award and payment: download the production pack and print directly.

---

## 4. Roadmap

### Phase A: Studio polish (≈ 1–2 weeks, frontend only)
1. Guided tour (6 steps, spotlight, Skip/Back/Next, shown once).
2. Split view on screens 1280px and wider.
3. Undo/redo (Ctrl+Z / Ctrl+Shift+Z) for all design changes.
4. Rotate layers; show/hide and lock layers; snap to centre lines.
5. Real-size readout in cm for every layer and print area.
6. Adaptive 3D quality (lower resolution while turning, full when still).

### Phase B: Production pack (≈ 2 weeks, frontend + backend)
1. Print-quality check on upload and placement (effective DPI at printed size).
2. Print files generated in the browser at launch (one PNG per side at 300 DPI, real size), uploaded to private storage.
3. Spec sheet PDF (jsPDF, already in the project): positions, sizes, fonts, colours, size breakdown, 3D snapshot.
4. Access rules:
   - spec sheet visible to eligible vendors during the auction;
   - print files only to the awarded vendor after escrow is funded (and to the buyer and admins);
   - every download logged.
5. Inside-label print side (design model, delivery estimate and vendor pricing note).

### Phase C: Trust and growth pages (≈ 1 week)
1. New landing page story: problem, then how it works (design, compete, escrow, inspect), then trust (KYB, escrow, PIN), then FAQ, then call to action.
2. How it works guide (buyer and printer tracks).
3. What's new changelog (v1.0 auction and escrow … v1.6 KYB and Facebook Login).
4. Suggest an idea form, plus an admin inbox.
5. Sinhala and Tamil interface translations (start with the main buyer pages).

### Phase D: Stretch / future work (thesis "future work" section)
More garment models (long sleeve, jersey); 360° turntable video of the design; per-size print scaling; vector print files (SVG/PDF) for text.

---

## 5. Why this is a strong thesis story

- **A clear research gap:** design tools stop at files, marketplaces start without precise specifications. CustomT connects them, and the production pack is the bridge.
- **Measurable outcomes** for the evaluation chapter:
  - lower price variance between bids (the existing coefficient-of-variation diagnostic);
  - fewer clarification chat messages per order;
  - first-time task success with versus without the guided tour.
- **IP protection** (print files released only after escrow) is a novel, defensible design choice.

---

## 6. Recommended next step

Start with **Phase A, items 1–6**. They are the most visible improvements, need no new infrastructure, and make every later demo better. Then do **Phase B**, which is the feature that sets CustomT apart.
