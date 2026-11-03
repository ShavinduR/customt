const lkr = new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lkrCompact = new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', notation: 'compact', maximumFractionDigits: 1 });

export const formatLKR = (value) => (value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : lkr.format(Number(value)));
export const formatLKRCompact = (value) => (value === null || value === undefined ? '—' : lkrCompact.format(Number(value)));

export const formatNumber = (value, digits = 0) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString('en-LK', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  return date.toLocaleString('en-LK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function formatRelative(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const units = [
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return 'just now';
}

/** 3725000 -> "01:02:05"; adds days when needed: "1d 02:00:00" */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const hms = [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${hms}` : hms;
}

export const titleCase = (text = '') =>
  String(text)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
