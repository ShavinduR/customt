/**
 * Escrow payment receipt as a vector PDF (selectable text, small file), drawn with jsPDF.
 * jsPDF is imported on demand so it never weighs down the rest of the app.
 *
 * Works for any viewer (buyer, vendor, admin) from a populated order: buyerId and vendorId as objects.
 */

const BRAND = [79, 70, 229];
const INK = [23, 23, 28];
const MUTED = [91, 91, 107];
const LINE = [222, 221, 230];
const SOFT = [243, 242, 251];

const money = (value) =>
  `LKR ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';

const LEDGER_LABEL = {
  ESCROW_DEPOSIT: 'Buyer payment locked in escrow',
  ADVANCE_RELEASE: 'Milestone 1: 30% advance released to vendor',
  FINAL_RELEASE: 'Milestone 2: 70% final settlement released to vendor',
  DISPUTE_RELEASE: 'Released to vendor after mediation',
  REFUND: 'Refunded to buyer wallet',
};

const STATUS_LINE = {
  ESCROW_LOCKED: 'PAID - FUNDS HELD IN ESCROW',
  PARTIALLY_RELEASED: 'PAID - 30% ADVANCE RELEASED',
  FROZEN: 'PAID - ESCROW FROZEN (DISPUTE)',
  FUNDS_RELEASED: 'COMPLETED - ALL FUNDS RELEASED',
  REFUNDED: 'REFUNDED TO BUYER',
  SPLIT_SETTLED: 'SETTLED BY MEDIATION',
};

/** Keeps generated text within the standard PDF font's character set. */
const plain = (text) =>
  String(text ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '');

export function receiptAvailable(order) {
  return Boolean(order?.payment?.transactionRef);
}

export async function downloadOrderReceipt(order) {
  if (!receiptAvailable(order)) throw new Error('A receipt is available once the order has been paid.');
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  let y = 0;

  const text = (value, x, yy, opts = {}) => doc.text(plain(value), x, yy, opts);
  const setFont = (size, style = 'normal', color = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const ensureSpace = (needed) => {
    if (y + needed > H - 24) {
      doc.addPage();
      y = M;
    }
  };

  const buyer = order.buyerId || {};
  const vendor = order.vendorId || {};
  const spec = order.specSnapshot || {};
  const ledger = order.escrowLedger || [];
  const released = ledger.filter((e) => ['ADVANCE_RELEASE', 'FINAL_RELEASE', 'DISPUTE_RELEASE'].includes(e.type)).reduce((s, e) => s + e.amount, 0);
  const refunded = ledger.filter((e) => e.type === 'REFUND').reduce((s, e) => s + e.amount, 0);
  const issued = new Date();

  // ── Header band ──
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 34, 'F');
  setFont(22, 'bold', [255, 255, 255]);
  text('CustomT', M, 17);
  setFont(9.5, 'normal', [224, 222, 255]);
  text('Custom apparel marketplace - escrow payment receipt', M, 25);
  setFont(13, 'bold', [255, 255, 255]);
  text('RECEIPT', W - M, 15, { align: 'right' });
  setFont(9, 'normal', [224, 222, 255]);
  text(`No. ${order.orderCode}-R`, W - M, 21.5, { align: 'right' });
  text(`Issued ${dateTime(issued)}`, W - M, 27, { align: 'right' });
  y = 46;

  // ── Status ribbon ──
  const status = STATUS_LINE[order.escrowStatus] || order.escrowStatus;
  doc.setFillColor(...SOFT);
  doc.setDrawColor(...LINE);
  doc.roundedRect(M, y - 6, W - 2 * M, 12, 2, 2, 'FD');
  setFont(10, 'bold', BRAND);
  text(status, M + 5, y + 1.5);
  setFont(10, 'bold');
  text(money(order.agreedPrice), W - M - 5, y + 1.5, { align: 'right' });
  y += 16;

  // ── Parties ──
  const colW = (W - 2 * M - 8) / 2;
  const party = (title, lines, x) => {
    setFont(8, 'bold', MUTED);
    text(title.toUpperCase(), x, y);
    setFont(10.5, 'bold');
    text(lines[0] || '-', x, y + 6);
    setFont(9.5, 'normal', MUTED);
    lines.slice(1).filter(Boolean).forEach((line, i) => text(line, x, y + 11.5 + i * 5));
  };
  party('Billed to (buyer)', [buyer.name, buyer.email, buyer.phone], M);
  party('Supplier (vendor)', [vendor.companyName || vendor.name, vendor.companyName ? `Contact: ${vendor.name}` : null, vendor.email, vendor.phone], M + colW + 8);
  y += 27;

  // ── Key/value block ──
  const rows = (title, pairs) => {
    ensureSpace(14 + pairs.length * 7);
    setFont(11, 'bold');
    text(title, M, y);
    y += 3;
    doc.setDrawColor(...LINE);
    doc.line(M, y, W - M, y);
    y += 6;
    pairs.forEach(([label, value]) => {
      setFont(9.5, 'normal', MUTED);
      text(label, M, y);
      setFont(9.5, 'normal');
      const wrapped = doc.splitTextToSize(plain(value), W - 2 * M - 52);
      doc.text(wrapped, M + 52, y);
      y += Math.max(1, wrapped.length) * 4.6 + 1.6;
    });
    y += 3;
  };

  rows('Order', [
    ['Order ID', order.orderCode],
    ['RFQ', `${spec.rfqCode || '-'}  ${spec.title ? `(${spec.title})` : ''}`],
    ['Item', `${spec.totalQuantity || '-'} pcs ${spec.garmentType || ''}, ${spec.fabric || ''} ${spec.gsm ? `${spec.gsm} GSM` : ''}, ${spec.printType || ''}`.replace(/\s+,/g, ',')],
    ['Unit price', money(order.unitPrice)],
    ['Agreed total', money(order.agreedPrice)],
    ['Committed lead time', `${order.leadTimeDays} days`],
    ['Order placed', dateTime(order.createdAt)],
  ]);

  rows('Payment', [
    ['Transaction reference', order.payment.transactionRef],
    ['Method', `${order.payment.cardBrand || 'Card'} ending ${order.payment.cardLast4 || '----'}`],
    ['Amount paid', money(order.payment.amount)],
    ['Paid on', dateTime(order.payment.paidAt)],
    ...(order.o2oVerifiedAt ? [['Delivery verified (O2O)', `${dateTime(order.o2oVerifiedAt)} by ${order.o2oMethod === 'PIN' ? 'buyer PIN' : order.o2oMethod === 'BUYER_APPROVAL' ? 'buyer approval' : 'mediation'}`]] : []),
  ]);

  // ── Escrow ledger table ──
  ensureSpace(30 + ledger.length * 8);
  setFont(11, 'bold');
  text('Escrow ledger', M, y);
  y += 4;
  doc.setFillColor(...SOFT);
  doc.rect(M, y, W - 2 * M, 8, 'F');
  setFont(8.5, 'bold', MUTED);
  text('DATE', M + 3, y + 5.4);
  text('DESCRIPTION', M + 45, y + 5.4);
  text('AMOUNT', W - M - 3, y + 5.4, { align: 'right' });
  y += 8;
  ledger.forEach((entry) => {
    ensureSpace(9);
    setFont(9, 'normal', MUTED);
    text(dateTime(entry.at), M + 3, y + 5.6);
    setFont(9.5, 'normal');
    text(LEDGER_LABEL[entry.type] || entry.type, M + 45, y + 5.6);
    text(`${entry.type === 'ESCROW_DEPOSIT' ? '' : '- '}${money(entry.amount)}`, W - M - 3, y + 5.6, { align: 'right' });
    y += 8;
    doc.setDrawColor(...LINE);
    doc.line(M, y, W - M, y);
  });
  y += 6;

  // ── Summary box ──
  const boxX = W - M - 82;
  const summary = [
    ['Agreed price', money(order.agreedPrice)],
    ['Released to vendor', money(released)],
    ...(refunded ? [['Refunded to buyer', money(refunded)]] : []),
  ];
  ensureSpace(summary.length * 7 + 17);
  doc.setDrawColor(...LINE);
  doc.roundedRect(boxX, y, 82, summary.length * 7 + 15, 2, 2, 'S');
  let sy = y + 7;
  summary.forEach(([label, value]) => {
    setFont(9.5, 'normal', MUTED);
    text(label, boxX + 4, sy);
    setFont(9.5, 'normal');
    text(value, boxX + 78, sy, { align: 'right' });
    sy += 7;
  });
  doc.setDrawColor(...BRAND);
  doc.line(boxX + 4, sy - 3.5, boxX + 78, sy - 3.5);
  setFont(10.5, 'bold', BRAND);
  text('Held in escrow', boxX + 4, sy + 2.5);
  text(money(order.escrowHeld), boxX + 78, sy + 2.5, { align: 'right' });

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(...LINE);
    doc.line(M, H - 18, W - M, H - 18);
    setFont(7.5, 'normal', MUTED);
    text('Payments on CustomT are held in escrow and released in two milestones: 30% when production starts and 70% after', M, H - 13);
    text('the buyer verifies the goods in person (O2O). Simulated escrow for a BICT research project; this is not a tax invoice.', M, H - 9.5);
    text(`Page ${i} of ${pages}`, W - M, H - 9.5, { align: 'right' });
  }

  doc.setProperties({ title: `CustomT receipt ${order.orderCode}`, subject: 'Escrow payment receipt', creator: 'CustomT' });
  doc.save(`CustomT-receipt-${order.orderCode}.pdf`);
}
