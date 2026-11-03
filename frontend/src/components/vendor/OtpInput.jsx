import { useRef } from 'react';
import { cx } from '../ui';

/** Six-box numeric code input with auto-advance, backspace navigation and paste support. */
export default function OtpInput({ value, onChange, length = 6, disabled = false, invalid = false }) {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const setAt = (index, digit) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join('').slice(0, length));
  };

  const onInput = (index, raw) => {
    const clean = raw.replace(/\D/g, '');
    if (!clean) {
      setAt(index, '');
      return;
    }
    if (clean.length > 1) {
      const merged = (digits.slice(0, index).join('') + clean).slice(0, length);
      onChange(merged);
      refs.current[Math.min(merged.length, length - 1)]?.focus();
      return;
    }
    setAt(index, clean);
    if (index < length - 1) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      setAt(index - 1, '');
      refs.current[index - 1]?.focus();
      e.preventDefault();
    }
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < length - 1) refs.current[index + 1]?.focus();
  };

  const onPaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div className="flex justify-center gap-1.5 sm:gap-2" onPaste={onPaste}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          aria-label={`PIN digit ${i + 1}`}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className={cx(
            'h-12 w-10 rounded-lg border bg-white text-center font-mono text-2xl font-bold text-slate-900 shadow-sm focus:outline-none focus:ring-2 sm:h-14 sm:w-12 sm:text-3xl',
            invalid ? 'border-red-300 focus:ring-red-200' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-100',
            disabled && 'bg-slate-50 text-slate-400'
          )}
        />
      ))}
    </div>
  );
}
