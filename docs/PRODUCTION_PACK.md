# Production pack

Phase B of the CustomT 2.0 roadmap (`docs/PRODUCT_VISION_V2.md`). The production pack turns the buyer's design into what a printer needs to produce it without clarification messages, and releases the print-ready artwork only once the buyer's payment is safe in escrow.

| Part | Who gets it | When | Where |
|---|---|---|---|
| **Print check** | Buyer | Live, while designing | Design studio → *Order* tab and *Artwork* tab |
| **Spec sheet (PDF)** | Buyer, bidding printers, admins | Any time (it is the locked RFQ) | *Spec sheet (PDF)* on the RFQ page, auction room and order pages |
| **Print files (ZIP)** | Winning printer, buyer, admins | Printer: once escrow is funded | *Production pack* card on the order page |

## Print check
`checkPrintQuality(specs)` in `frontend/src/utils/productionPack.js`:

- **Image resolution at the real printed size:**
  - effective DPI = image pixels ÷ printed width in inches;
  - ≥ 200 is sharp, ≥ 150 acceptable, ≥ 100 "may look soft", below 100 "will print blurry";
  - SVG is vector, so it is always sharp.
- **Artwork outside the print area:**
  - the layer's rotated box is compared with its side's print area, with 0.5 cm of slack;
  - text is **measured with the real font** (canvas `measureText`), not estimated.

Warnings appear in the studio (*Order* tab → *Print check*; *Artwork* tab → *Print quality* on the selected image). They don't block a launch.

## Spec sheet
`buildSpecSheet(specs, meta)` produces an A4 PDF with jsPDF. It contains:

- garment, fabric/GSM, print method, quantity, printed sides, delivery, base colour swatch;
- the **trims** at cut size (neck rib, collar, hoodie waistband and cuffs), to be matched to the base colour;
- **front and back flat views**, cut from the same texture that paints the 3D model;
- the size breakdown;
- for every printed side:
  - the **print area** (for example 30 × 40 cm, top edge 12.2 cm below the high point of the shoulder) and the matching print-file name;
  - for every layer: **real size** (cm), **position** (from the centre line, wearer's left or right, and below the HPS), rotation, font and colour or image pixels, and **print quality**;
  - a warning when artwork runs outside the print area.
- the buyer's notes.

Every bidder quotes on the same measured facts, which is meant to narrow the price spread between bids (the CV diagnostic in the auction).

## Inside label

The **inside label** is a print side of its own: an 8 × 7 cm area printed on the inside of the back, with its top edge 1.5 cm below the neck seam (a tagless brand label).
- In the studio it has its own **Label** view (the inside of the back neck), and a window on the pattern sheet. A **Neck label** placement preset puts a logo there at 6 cm wide.
- It never shows on the outside: not in the 3D model, the photo preview or the front/back views. On the back pattern piece a dashed box marks where it goes.
- It counts as a printed side (one more production day, its own print file), and the spec sheet says it is printed inside.

## Print files
`renderPrintFile(specs, side)`:

- **One transparent PNG per printed side** covering that side's whole print area at **real size, 300 DPI**. For example, a 30 × 40 cm front is 3543 × 4724 px.
- **The same drawing code as the 3D texture** (`drawLayer`), without preview effects (shadows, sheen). The file therefore matches the approved design exactly, fonts included.
- **A PNG `pHYs` chunk records 300 DPI**, so RIP and print software open the file at its true physical size instead of reading it as 72 DPI.
- **Phone fallback:** falls back to 200 DPI if the device cannot allocate the canvas (some phones cap canvases at about 16.7 million pixels).

`downloadProductionPack(specs, meta)` zips the PNGs, `spec-sheet.pdf` and a `README.txt` (with `fflate`). The Android app hands the ZIP to the share sheet.

## Access rule
The order page shows the production pack to:

- **the buyer and admins:** always;
- **the awarded printer:** only once escrow is funded (`ESCROW_LOCKED` or later), never for cancelled or refunded orders.

The printer can't start unpaid, and the buyer's production artwork isn't handed over before the money is safe.

**Limitation (future work):** the files are generated in the browser from the locked specification, whose uploaded images are public URLs, and bidders already see them in the spec preview. The rule therefore controls **when the production pack is offered**; it does not encrypt the artwork. Making originals private (signed URLs, watermarked previews for bidders) is the next step for real IP protection.
