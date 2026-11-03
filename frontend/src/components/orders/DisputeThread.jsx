import { useState } from 'react';
import { Bot, Scale, Send, Store, User } from 'lucide-react';
import { orderApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Textarea, cx } from '../ui';
import { formatDate } from '../../utils/format';

const AUTHOR = {
  system: { label: 'CustomT Resolution Team', icon: Bot, cls: 'bg-brand-50 border-brand-100' },
  buyer: { label: 'Buyer', icon: User, cls: 'bg-white border-slate-200' },
  vendor: { label: 'Vendor', icon: Store, cls: 'bg-amber-50 border-amber-100' },
  admin: { label: 'Mediator', icon: Scale, cls: 'bg-emerald-50 border-emerald-100' },
};

const TEMPLATE_LABEL = {
  BUYER_ACKNOWLEDGEMENT: 'Acknowledgement',
  VENDOR_NOTIFICATION: 'Notice',
  ADMIN_CASE_SUMMARY: 'Case summary',
  FOLLOW_UP: 'Message',
  RESOLUTION: 'Resolution',
};

/** Politeness-CRM conversation for a disputed order. */
export default function DisputeThread({ order, onNoteAdded, viewerRole = 'buyer' }) {
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const notes = order.disputeNotes || [];
  const open = order.dispute?.isOpen;

  const send = async () => {
    if (message.trim().length < 2) return;
    setBusy(true);
    try {
      await orderApi.addDisputeNote(order._id, message.trim());
      setMessage('');
      onNoteAdded();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {notes.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
      {notes.map((note) => {
        const base = AUTHOR[note.authorRole] || AUTHOR.system;
        const author = note.authorRole === viewerRole ? { ...base, label: 'You' } : base;
        const Icon = author.icon;
        return (
          <div key={note._id} className={cx('rounded-xl border p-4', author.cls)}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Icon className="h-4 w-4" />
              <span className="font-semibold text-slate-700">{author.label}</span>
              {TEMPLATE_LABEL[note.template] && <Badge tone="slate">{TEMPLATE_LABEL[note.template]}</Badge>}
              <span className="ml-auto">{formatDate(note.createdAt)}</span>
            </div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{note.message}</p>
          </div>
        );
      })}
      {open && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <Textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={viewerRole === 'admin' ? 'Write to both parties: acknowledge feelings first, then facts and next steps…' : 'Add details, photo links or a proposed remedy for the mediator…'} />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">{viewerRole === 'admin' ? 'Your message is shared with the buyer and the vendor.' : `Messages are shared with the ${viewerRole === 'vendor' ? 'buyer' : 'vendor'} and the mediator.`}</p>
            <Button size="sm" icon={Send} loading={busy} disabled={message.trim().length < 2} onClick={send}>
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
