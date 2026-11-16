/**
 * Server-side inspection of uploaded KYB documents. The browser's declared type and filename are never
 * trusted: the type comes from the file's own bytes, risky PDFs are refused, and images are re-encoded
 * (which strips EXIF metadata such as GPS location and neutralises "polyglot" files).
 */
const crypto = require('crypto');
const sharp = require('sharp');
const ApiError = require('./ApiError');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Detects the real type from magic bytes: 'application/pdf' | 'image/jpeg' | 'image/png' | null. */
function sniffType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(PNG)) return 'image/png';
  return null;
}

// Active or hidden content has no place in a BR copy, a bill or an invoice.
const PDF_DANGER = [
  { re: /\/JavaScript\b/, why: 'contains JavaScript' },
  { re: /\/JS\b/, why: 'contains JavaScript' },
  { re: /\/Launch\b/, why: 'tries to launch programs' },
  { re: /\/EmbeddedFiles?\b/, why: 'contains embedded files' },
  { re: /\/RichMedia\b/, why: 'contains rich media' },
  { re: /\/Encrypt\b/, why: 'is password-protected or encrypted' },
  { re: /\/XFA\b/, why: 'contains a dynamic form' },
];

function pdfProblem(buffer) {
  const text = buffer.toString('latin1');
  if (!/%%EOF\s*$/.test(text.slice(-1024))) return 'is incomplete or damaged';
  const hit = PDF_DANGER.find((d) => d.re.test(text));
  return hit ? hit.why : null;
}

/**
 * Validates and sanitises one file.
 * @returns {{ buffer: Buffer, mimeType: string, ext: string, sha256: string, sizeBytes: number }}
 */
async function inspectDocument(buffer) {
  const mimeType = sniffType(buffer);
  if (!mimeType) throw ApiError.badRequest('Upload a PDF, JPG or PNG file', { code: 'KYB_FILE_TYPE' });

  let clean = buffer;
  if (mimeType === 'application/pdf') {
    const problem = pdfProblem(buffer);
    if (problem) throw ApiError.badRequest(`This PDF ${problem}. Please upload a plain scan or a normal PDF.`, { code: 'KYB_PDF_REJECTED' });
  } else {
    try {
      const image = sharp(buffer, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate(); // apply EXIF orientation, then drop all metadata
      clean = mimeType === 'image/png' ? await image.png({ compressionLevel: 9 }).toBuffer() : await image.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    } catch {
      throw ApiError.badRequest('This image is damaged or not a real JPG/PNG', { code: 'KYB_IMAGE_INVALID' });
    }
  }
  return {
    buffer: clean,
    mimeType,
    ext: { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[mimeType],
    sha256: crypto.createHash('sha256').update(clean).digest('hex'),
    sizeBytes: clean.length,
  };
}

module.exports = { sniffType, pdfProblem, inspectDocument };
