import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Ban, CheckCheck, Eye, MessagesSquare, Send, ShieldCheck } from 'lucide-react';
import { orderApi } from '../../api/client';
import { useSocket, useSocketEvent } from '../../context/SocketContext';
import { Alert, Badge, Button, Card, CardHeader, Spinner, cx } from '../ui';
import { formatDate } from '../../utils/format';

const BLOCK = '[CONTACT BLOCKED]';
const MAX = 1000;
const FLAG_LABEL = {
  phone: 'phone number',
  email: 'e-mail',
  link: 'link',
  app: 'messaging app',
  'contact-request': 'contact request',
  payment: 'off-escrow payment',
};

/** Renders message text, turning each "[CONTACT BLOCKED]" into a visible chip. */
function MessageText({ text }) {
  const parts = String(text).split(BLOCK);
  return parts.map((part, i) => (
    // eslint-disable-next-line react/no-array-index-key
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <span className="mx-0.5 inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-px align-baseline text-xs font-semibold text-red-700">
          <Ban className="h-3 w-3" /> contact blocked
        </span>
      )}
    </Fragment>
  ));
}

/**
 * Buyer-vendor chat for one order.
 * viewerRole "buyer" | "vendor": can send. viewerRole "admin": read-only monitor that also shows the
 * unfiltered original of any blocked message.
 */
export default function OrderChat({ orderId, viewerRole, counterpartName, compact = false }) {
  const { connected, emitWithAck } = useSocket();
  const isAdmin = viewerRole === 'admin';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [blockedNotice, setBlockedNotice] = useState(null);
  const listRef = useRef(null);
  const nearBottom = useRef(true);

  const load = useCallback(async () => {
    try {
      setData(await orderApi.messages(orderId));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const addMessage = useCallback((message) => {
    setData((prev) => {
      if (!prev || prev.messages.some((m) => m._id === message._id)) return prev;
      return { ...prev, messages: [...prev.messages, message] };
    });
  }, []);

  // Mark the other side's messages as read while this chat is on screen.
  const unreadFromOther = !isAdmin && data ? data.messages.some((m) => m.senderRole !== viewerRole && !m.readAt) : false;
  useEffect(() => {
    if (!unreadFromOther || document.visibilityState !== 'visible') return;
    const markLocal = () =>
      setData((prev) => prev && { ...prev, unread: 0, messages: prev.messages.map((m) => (m.senderRole !== viewerRole && !m.readAt ? { ...m, readAt: new Date().toISOString() } : m)) });
    const request = connected ? emitWithAck('chat:read', { orderId }) : orderApi.markMessagesRead(orderId);
    request.then(markLocal).catch(() => {});
  }, [unreadFromOther, connected, emitWithAck, orderId, viewerRole]);

  useSocketEvent('chat:message', (p) => p.orderId === orderId && addMessage(p.message));
  useSocketEvent('chat:monitor', (p) => isAdmin && p.orderId === orderId && addMessage(p.message));
  useSocketEvent('chat:read', (p) => {
    if (p.orderId !== orderId) return;
    setData((prev) => prev && { ...prev, messages: prev.messages.map((m) => (m.senderRole === viewerRole && !m.readAt ? { ...m, readAt: p.readAt } : m)) });
  });

  // Keep the newest message in view, unless the user scrolled up to read history.
  const count = data?.messages.length || 0;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = async (e) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const result = connected ? (await emitWithAck('chat:send', { orderId, body })).result : await orderApi.sendMessage(orderId, body);
      addMessage(result.message);
      setDraft('');
      nearBottom.current = true;
      setBlockedNotice(result.blocked?.length ? result.blocked : null);
    } catch (err) {
      setSendError(err);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) send(e);
  };

  const lastMineIndex = data ? data.messages.map((m) => m.senderRole === viewerRole).lastIndexOf(true) : -1;
  const flaggedCount = data ? data.messages.filter((m) => m.flagged).length : 0;

  return (
    <Card>
      <CardHeader
        icon={MessagesSquare}
        title={isAdmin ? 'Buyer-vendor chat (monitoring)' : `Chat with ${counterpartName || (viewerRole === 'buyer' ? 'the vendor' : 'the buyer')}`}
        subtitle={isAdmin ? 'Read-only. Originals of blocked messages are visible to admins only.' : 'Keep every conversation here so your escrow protection stays valid.'}
        action={
          <div className="flex gap-1.5">
            {isAdmin && flaggedCount > 0 && <Badge tone="red">{flaggedCount} flagged</Badge>}
            {!isAdmin && data?.unread > 0 && <Badge tone="brand">{data.unread} new</Badge>}
          </div>
        }
      />
      {!isAdmin && (
        <p className="flex items-start gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-xs text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          Messages are monitored. Phone numbers, e-mail addresses, links and outside apps are hidden automatically, and payments outside escrow aren't
          protected.
        </p>
      )}

      {error ? (
        <div className="p-5">
          <Alert tone="danger">{error.message}</Alert>
        </div>
      ) : !data ? (
        <Spinner className="py-10" label="Loading messages…" />
      ) : (
        <>
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className={cx('space-y-3 overflow-y-auto px-5 py-4', compact ? 'max-h-80' : 'max-h-[28rem]')}
            aria-live="polite"
          >
            {data.messages.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">
                {isAdmin ? 'No messages in this order yet.' : 'No messages yet. Say hello and agree on the details of the hand-over.'}
              </p>
            )}
            {data.messages.map((m, i) => {
              const mine = !isAdmin && m.senderRole === viewerRole;
              const right = isAdmin ? m.senderRole === 'vendor' : mine;
              return (
                <div key={m._id} className={cx('flex flex-col', right ? 'items-end' : 'items-start')}>
                  <p className="mb-0.5 px-1 text-[11px] text-slate-500">
                    {mine ? 'You' : m.senderName}
                    {isAdmin && <span className="ml-1 uppercase">· {m.senderRole}</span>} · {formatDate(m.createdAt)}
                  </p>
                  <div
                    className={cx(
                      'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm',
                      right ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800',
                      m.flagged && isAdmin && 'ring-2 ring-red-300'
                    )}
                  >
                    <MessageText text={m.body} />
                  </div>
                  {isAdmin && m.originalBody && (
                    <div className="mt-1 max-w-[85%] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                      <p className="flex items-center gap-1 font-semibold">
                        <Eye className="h-3.5 w-3.5" /> Original (admin only) · blocked: {(m.flags || []).map((f) => FLAG_LABEL[f] || f).join(', ')}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words">{m.originalBody}</p>
                    </div>
                  )}
                  {mine && i === lastMineIndex && m.readAt && (
                    <p className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-slate-400">
                      <CheckCheck className="h-3.5 w-3.5" /> Seen
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {blockedNotice && (
            <div className="px-5">
              <Alert tone="warning" title="We hid contact details in your message">
                Removed: {blockedNotice.map((f) => FLAG_LABEL[f] || f).join(', ')}. Deals and payments arranged outside CustomT lose escrow protection and dispute
                support.
              </Alert>
            </div>
          )}

          {data.canSend ? (
            <form onSubmit={send} className="border-t border-slate-100 p-4">
              <label htmlFor={`chat-${orderId}`} className="sr-only">
                Message
              </label>
              <textarea
                id={`chat-${orderId}`}
                rows={2}
                maxLength={MAX}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
                className="block w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">
                  {draft.length}/{MAX}
                </span>
                <Button type="submit" size="sm" icon={Send} loading={sending} disabled={!draft.trim()}>
                  Send
                </Button>
              </div>
              {sendError && <p className="mt-2 text-sm text-red-600">{sendError.message}</p>}
            </form>
          ) : (
            !isAdmin && <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">This chat is closed because the order was cancelled.</p>
          )}
        </>
      )}
    </Card>
  );
}
