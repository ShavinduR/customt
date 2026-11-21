# Garment photos (photo preview)

Grey "shading maps" used by the photo preview (`src/utils/photoMockup.js`): each is a garment photographed in light
grey on a transparent background, 800 × 900 px. Plain fabric is about 80 % grey; the app multiplies it by the chosen
colour and lays the print over the folds.

| File | Garment | Side |
|---|---|---|
| `crew-front.png` | Crew-neck T-shirt | front |
| `vneck-front.png` | V-neck T-shirt | front |
| `tee-back.png` | Crew-neck and V-neck T-shirt | back |
| `polo-front.png` | Polo | front |
| `polo-back.png` | Polo | back |

Provenance: contributed from a classmate's CustomT design prototype. **Confirm the photos' licence allows use in this
project before deploying publicly.** To run without them, remove the
garment entries from `PHOTO_MOCKUPS`: the studio then offers the 3D view only and documents use the flat views.

To add a garment photo: export a grey, background-free PNG at 800 × 900, then add its calibration (centre line,
shoulder line, hem line, chest width in pixels, measured from the alpha mask) to `PHOTO_MOCKUPS` in
`src/utils/photoMockup.js`.
