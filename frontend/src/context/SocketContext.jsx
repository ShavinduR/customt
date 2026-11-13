import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import { API_URL } from '../api/client';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const SocketContext = createContext(null);

/**
 * Events that produce a notification-centre entry (and a toast) for the current user.
 * The server only delivers each event to users entitled to it, so no role filtering is needed here.
 */
const NOTIFY = {
  'rfq:new': { tone: 'info', title: 'New RFQ launched', text: (p) => `${p.rfq?.title} — ${p.rfq?.designSpecs?.totalQuantity} pcs of ${p.rfq?.designSpecs?.printType}` },
  'auction:extended': { tone: 'warning', title: 'Auction extended', text: (p) => p.message },
  'auction:ended': { tone: 'info', title: 'Auction ended', text: (p) => p.message },
  'auction:awarded': { tone: 'success', title: 'You won an auction!', text: (p) => p.message },
  'auction:closed': { tone: 'info', title: 'Auction closed', text: (p) => `${p.rfqCode || 'An RFQ'} is now ${String(p.status).toLowerCase()}.` },
  'auction:lost': { tone: 'info', title: 'Auction awarded elsewhere', text: (p) => p.message },
  'order:created': { tone: 'success', title: 'Order created', text: (p) => `Order ${p.orderCode} is waiting for escrow funding.` },
  'order:updated': { tone: 'info', title: 'Order update', text: (p) => p.message || `Order ${p.orderCode} was updated.` },
  'order:completed': { tone: 'success', title: 'Order completed', text: (p) => p.message || `Order ${p.orderCode} completed and funds released.` },
  'o2o:ready': { tone: 'success', title: 'Ready for inspection', text: (p) => `Order ${p.orderCode}: your O2O PIN is now available.` },
  'o2o:failed-attempt': { tone: 'warning', title: 'Incorrect O2O PIN entered', text: (p) => `Order ${p.orderCode}: ${p.attemptsRemaining} attempt(s) remaining.` },
  'dispute:raised': { tone: 'warning', title: 'Dispute opened', text: (p) => `Order ${p.orderCode}: escrow is frozen pending mediation.` },
  'dispute:resolved': { tone: 'success', title: 'Dispute resolved', text: (p) => `Order ${p.orderCode}: ${String(p.resolution).replace(/_/g, ' ').toLowerCase()}.` },
  'dispute:new': { tone: 'warning', title: 'New dispute to mediate', text: (p) => `Order ${p.orderCode}${p.toneFlagged ? ' (heightened emotion detected)' : ''}: escrow frozen.` },
  'vendor:registered': { tone: 'info', title: 'Vendor awaiting verification', text: (p) => `${p.companyName || p.name}${p.reverification ? ' changed their profile and needs re-verification' : ' registered'}.` },
  'dispute:note': { tone: 'info', title: 'New dispute message', text: (p) => `Order ${p.orderCode}` },
  'vendor:verification': { tone: 'success', title: 'Verification update', text: (p) => p.message },
  'chat:message': {
    tone: 'info',
    title: 'New message',
    text: (p) => `${p.message?.senderName}: ${String(p.message?.body || '').slice(0, 90)}`,
    // Not for your own messages, and not while that order's chat is already on screen.
    skip: (p, ctx) => p.message?.senderId === ctx.userId || ctx.pathname.includes(p.orderId),
  },
  'chat:flagged': {
    tone: 'warning',
    title: 'Contact details blocked in chat',
    text: (p) => `${p.senderName} in ${p.orderCode}: ${(p.flags || []).join(', ')}`,
  },
  'vendor:trust-updated': { tone: 'info', title: 'Trust score updated', text: (p) => `New trust score: ${p.trustScore} (was ${p.previousTrustScore}).` },
};

/** Events shown in the bell only (they fire frequently or the current page already reacts to them). */
const SILENT_TOAST = new Set(['dispute:note', 'order:updated', 'auction:closed']);

export function SocketProvider({ children }) {
  const { token, user } = useAuth();
  const toast = useToast();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const counter = useRef(0);
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  useEffect(() => {
    if (!token || !user) {
      setSocket(null);
      setConnected(false);
      return undefined;
    }
    const instance = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 8000,
    });
    instance.on('connect', () => setConnected(true));
    instance.on('disconnect', () => setConnected(false));
    instance.on('connect_error', () => setConnected(false));

    Object.entries(NOTIFY).forEach(([event, cfg]) => {
      instance.on(event, (payload) => {
        if (cfg.skip && cfg.skip(payload || {}, { userId: user?._id, pathname: pathnameRef.current })) return;
        const text = cfg.text(payload || {});
        counter.current += 1;
        setNotifications((list) =>
          [{ id: counter.current, event, title: cfg.title, text, tone: cfg.tone, payload, at: new Date(), read: false }, ...list].slice(0, 40)
        );
        if (!SILENT_TOAST.has(event)) toast[cfg.tone === 'warning' ? 'warning' : cfg.tone === 'success' ? 'success' : 'info'](text, { title: cfg.title });
      });
    });

    setSocket(instance);
    return () => {
      instance.removeAllListeners();
      instance.disconnect();
    };
    // toast is stable (memoised); user identity changes are captured by token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?._id]);

  const markAllRead = useCallback(() => setNotifications((list) => list.map((n) => ({ ...n, read: true }))), []);
  const clearNotifications = useCallback(() => setNotifications([]), []);

  /** Emit with acknowledgement as a promise: resolves on { ok:true }, rejects with the server error. */
  const emitWithAck = useCallback(
    (event, payload, timeoutMs = 10000) =>
      new Promise((resolve, reject) => {
        if (!socket) {
          reject(new Error('Real-time connection is not ready yet'));
          return;
        }
        socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
          if (err) reject(new Error('The server did not respond in time'));
          else if (res?.ok) resolve(res);
          else {
            const error = new Error(res?.error?.message || 'Request failed');
            error.code = res?.error?.code;
            error.details = res?.error?.details;
            reject(error);
          }
        });
      }),
    [socket]
  );

  const value = useMemo(
    () => ({ socket, connected, notifications, markAllRead, clearNotifications, emitWithAck }),
    [socket, connected, notifications, markAllRead, clearNotifications, emitWithAck]
  );
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside SocketProvider');
  return ctx;
}

/** Subscribe to a socket event for the component's lifetime, always calling the latest handler. */
export function useSocketEvent(event, handler) {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return undefined;
    const listener = (payload) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }, [socket, event]);
}

/** Subscribe one handler to several socket events (stable list). */
export function useSocketEvents(events, handler) {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = events.join('|');

  useEffect(() => {
    if (!socket) return undefined;
    const names = key.split('|');
    const listeners = names.map((name) => {
      const listener = (payload) => handlerRef.current(payload, name);
      socket.on(name, listener);
      return [name, listener];
    });
    return () => listeners.forEach(([name, listener]) => socket.off(name, listener));
  }, [socket, key]);
}
