import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { uploadApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { cx } from '../ui';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export default function LogoUploader({ value, onChange, maxMb = 2 }) {
  const inputRef = useRef(null);
  const toast = useToast();
  const [progress, setProgress] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file) => {
    if (!file) return;
    if (!ACCEPT.includes(file.type)) {
      toast.error('Please choose a PNG, JPG, WEBP or SVG image.');
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`The logo must be smaller than ${maxMb} MB.`);
      return;
    }
    setProgress(0);
    try {
      const res = await uploadApi.logo(file, setProgress);
      onChange(res.url);
      toast.success('Logo uploaded');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
        <div className="checkerboard flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-slate-200">
          <img src={value} alt="Uploaded logo" className="max-h-full max-w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">Logo ready</p>
          <p className="truncate text-xs text-slate-500">Drag it on the preview to position it</p>
        </div>
        <button type="button" onClick={() => inputRef.current?.click()} className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
          Replace
        </button>
        <button type="button" onClick={() => onChange('')} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove logo">
          <Trash2 className="h-4 w-4" />
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT.join(',')} className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        upload(e.dataTransfer.files?.[0]);
      }}
      className={cx('rounded-xl border-2 border-dashed p-5 text-center transition', dragOver ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-slate-50')}
    >
      {progress !== null ? (
        <div className="flex flex-col items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
          Uploading… {progress}%
        </div>
      ) : (
        <>
          <ImagePlus className="mx-auto h-7 w-7 text-slate-400" />
          <p className="mt-2 text-sm text-slate-600">
            Drop your logo here or{' '}
            <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-brand-700 hover:underline">
              browse
            </button>
          </p>
          <p className="mt-1 text-xs text-slate-400">PNG with transparent background works best · max {maxMb} MB</p>
        </>
      )}
      <input ref={inputRef} type="file" accept={ACCEPT.join(',')} className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
