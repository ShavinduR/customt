import axios from 'axios';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

const TOKEN_KEY = 'customt_token';

/** localStorage can throw (private mode / blocked storage) - never let that break the app. */
export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable - session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

const http = axios.create({ baseURL: `${API_URL}/api`, timeout: 25000 });

let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const data = error.response?.data || {};
    let message = data.message;
    if (!message) {
      if (error.code === 'ECONNABORTED') message = 'The request timed out. Please try again.';
      else if (error.message === 'Network Error') message = 'Cannot reach the CustomT server. Check your connection.';
      else message = 'Something went wrong. Please try again.';
    }
    const normalized = new Error(message);
    normalized.status = status;
    normalized.code = data.code;
    normalized.details = data.details;
    if (status === 401 && unauthorizedHandler && !error.config?.skipAuthRedirect) unauthorizedHandler();
    return Promise.reject(normalized);
  }
);

const unwrap = (promise) => promise.then((res) => res.data);

export const authApi = {
  register: (payload) => unwrap(http.post('/auth/register', payload, { skipAuthRedirect: true })),
  login: (payload) => unwrap(http.post('/auth/login', payload, { skipAuthRedirect: true })),
  me: () => unwrap(http.get('/auth/me')),
  updateMe: (payload) => unwrap(http.patch('/auth/me', payload)),
  changePassword: (payload) => unwrap(http.patch('/auth/me/password', payload)),
  forgotPassword: (email) => unwrap(http.post('/auth/forgot-password', { email }, { skipAuthRedirect: true })),
  resetPassword: (token, password) => unwrap(http.post('/auth/reset-password', { token, password }, { skipAuthRedirect: true })),
  // Facebook Login
  exchange: (code) => unwrap(http.post('/auth/exchange', { code }, { skipAuthRedirect: true })),
  facebookSignup: (ticket) => unwrap(http.get('/auth/facebook/signup', { params: { ticket }, skipAuthRedirect: true })),
  facebookComplete: (payload) => unwrap(http.post('/auth/facebook/complete', payload, { skipAuthRedirect: true })),
  facebookLink: () => unwrap(http.post('/auth/facebook/link')),
  facebookUnlink: () => unwrap(http.delete('/auth/facebook')),
};

/** Full-page navigation target that starts Facebook Login on the API (server-side OAuth). */
export const facebookLoginUrl = (linkTicket) => `${API_URL}/api/auth/facebook${linkTicket ? `?link=${encodeURIComponent(linkTicket)}` : ''}`;

export const metaApi = {
  catalog: () => unwrap(http.get('/meta/catalog')),
};

export const uploadApi = {
  logo: (file, onProgress) => {
    const form = new FormData();
    form.append('logo', file);
    return unwrap(
      http.post('/uploads/logo', form, {
        onUploadProgress: (e) => onProgress && e.total && onProgress(Math.round((e.loaded / e.total) * 100)),
      })
    );
  },
};

export const rfqApi = {
  preview: (designSpecs, directVendorId) => unwrap(http.post('/rfqs/preview', { designSpecs, ...(directVendorId ? { directVendorId } : {}) })),
  create: (payload) => unwrap(http.post('/rfqs', payload)),
  list: (params) => unwrap(http.get('/rfqs', { params })),
  get: (id) => unwrap(http.get(`/rfqs/${id}`)),
  cancel: (id, reason) => unwrap(http.post(`/rfqs/${id}/cancel`, { reason })),
  acceptBid: (id, bidId) => unwrap(http.post(`/rfqs/${id}/bids/${bidId}/accept`)),
  placeBid: (id, payload) => unwrap(http.post(`/rfqs/${id}/bids`, payload)),
};

export const orderApi = {
  list: (params) => unwrap(http.get('/orders', { params })),
  get: (id) => unwrap(http.get(`/orders/${id}`)),
  pay: (id, card) => unwrap(http.post(`/orders/${id}/pay`, card)),
  cancel: (id) => unwrap(http.post(`/orders/${id}/cancel`)),
  o2o: (id) => unwrap(http.get(`/orders/${id}/o2o`)),
  regeneratePin: (id) => unwrap(http.post(`/orders/${id}/o2o/regenerate`)),
  approveInspection: (id) => unwrap(http.post(`/orders/${id}/o2o/approve`)),
  rate: (id, payload) => unwrap(http.post(`/orders/${id}/rate`, payload)),
  dispute: (id, payload) => unwrap(http.post(`/orders/${id}/dispute`, payload)),
  addDisputeNote: (id, message) => unwrap(http.post(`/orders/${id}/dispute/notes`, { message })),
  updateProduction: (id, status, note) => unwrap(http.patch(`/orders/${id}/production`, { status, note })),
  verifyPin: (id, pin) => unwrap(http.post(`/orders/${id}/o2o/verify`, { pin })),
  messages: (id) => unwrap(http.get(`/orders/${id}/messages`)),
  sendMessage: (id, body) => unwrap(http.post(`/orders/${id}/messages`, { body })),
  markMessagesRead: (id) => unwrap(http.post(`/orders/${id}/messages/read`)),
};

export const vendorApi = {
  status: () => unwrap(http.get('/vendor/status')),
  rfqs: (params) => unwrap(http.get('/vendor/rfqs', { params })),
  bids: (params) => unwrap(http.get('/vendor/bids', { params })),
  wallet: () => unwrap(http.get('/vendor/wallet')),
  updateStorefront: (payload) => unwrap(http.patch('/vendor/storefront', payload)),
};

/** KYB vendor onboarding (applicant side). There are no ids: it always works on your own application. */
export const kybApi = {
  get: () => unwrap(http.get('/kyb/application')),
  save: (payload) => unwrap(http.put('/kyb/application', payload)),
  upload: ({ type, file, issuedOn }, onProgress) => {
    const form = new FormData();
    form.append('type', type);
    if (issuedOn) form.append('issuedOn', issuedOn);
    form.append('file', file);
    return unwrap(
      http.post('/kyb/application/documents', form, {
        onUploadProgress: (e) => onProgress && e.total && onProgress(Math.round((e.loaded / e.total) * 100)),
      })
    );
  },
  removeDocument: (docId) => unwrap(http.delete(`/kyb/application/documents/${docId}`)),
  submit: () => unwrap(http.post('/kyb/application/submit', { consent: true })),
  withdraw: () => unwrap(http.post('/kyb/application/withdraw')),
};

/** KYB review (admins). Documents are fetched with the auth header as a Blob, never as a public URL. */
export const adminKybApi = {
  list: (params) => unwrap(http.get('/admin/vendor-applications', { params })),
  get: (id) => unwrap(http.get(`/admin/vendor-applications/${id}`)),
  documentBlob: (id, docId) => http.get(`/admin/vendor-applications/${id}/documents/${docId}`, { responseType: 'blob' }).then((res) => res.data),
  documentLink: (id, docId) => unwrap(http.get(`/admin/vendor-applications/${id}/documents/${docId}/link`)),
  reviewDocument: (id, docId, payload) => unwrap(http.post(`/admin/vendor-applications/${id}/documents/${docId}/review`, payload)),
  decide: (id, payload) => unwrap(http.post(`/admin/vendor-applications/${id}/decision`, payload)),
};

/** Phase 5: Global Feed and vendor posts. `cursor` comes from the previous page's `nextCursor`. */
export const postApi = {
  feed: ({ type, cursor, limit } = {}) => unwrap(http.get('/posts', { params: { type: type || undefined, cursor: cursor || undefined, limit } })),
  get: (id) => unwrap(http.get(`/posts/${id}`)),
  create: (payload) => unwrap(http.post('/posts', payload)),
  remove: (id) => unwrap(http.delete(`/posts/${id}`)),
};

export const storefrontApi = {
  get: (vendorId, { type, cursor, limit } = {}) =>
    unwrap(http.get(`/vendors/${vendorId}/storefront`, { params: { type: type || undefined, cursor: cursor || undefined, limit } })),
};

export const adminApi = {
  vendors: (params) => unwrap(http.get('/admin/vendors', { params })),
  setVerification: (id, payload) => unwrap(http.patch(`/admin/vendors/${id}/verification`, payload)),
  setBadges: (id, skillBadges) => unwrap(http.patch(`/admin/vendors/${id}/badges`, { skillBadges })),
  users: (params) => unwrap(http.get('/admin/users', { params })),
  setUserStatus: (id, isActive) => unwrap(http.patch(`/admin/users/${id}/status`, { isActive })),
  liveAuctions: () => unwrap(http.get('/admin/auctions/live')),
  orders: (params) => unwrap(http.get('/admin/orders', { params })),
  disputes: (state) => unwrap(http.get('/admin/disputes', { params: { state } })),
  resolveDispute: (id, payload) => unwrap(http.post(`/admin/orders/${id}/resolve`, payload)),
  analytics: () => unwrap(http.get('/admin/analytics')),
  conversations: (params) => unwrap(http.get('/admin/conversations', { params })),
};

export default http;
