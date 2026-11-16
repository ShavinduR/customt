/**
 * Facebook Login: server-side OAuth 2.0 Authorization Code flow.
 *
 *  1. Browser -> GET /api/auth/facebook              : we create a random `state`, store its hash, set it in an
 *                                                      HttpOnly cookie and redirect to Facebook's login dialog.
 *  2. Facebook -> GET /api/auth/facebook/callback     : the state in the URL must match the cookie (CSRF). The
 *                                                      code is exchanged server-to-server with the app secret;
 *                                                      the profile is read with appsecret_proof. The Facebook
 *                                                      access token is used once and never stored.
 *  3. We redirect to the web app with a one-time `login_code` (60 s), never with a session token in the URL.
 *     The app exchanges it with POST /api/auth/exchange for the normal JWT.
 *
 * Account matching (prevents account takeover):
 *  - Facebook id already linked          -> sign in
 *  - new id, e-mail not used on CustomT  -> new BUYER account after the user adds a phone number
 *  - new id, e-mail already used         -> NOT linked automatically; sign in with the password and link
 *                                           Facebook from the Account page
 *  - Facebook gave no e-mail             -> asked to register with e-mail instead
 */
const crypto = require('crypto');
const { User, AuthTicket } = require('../models');
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');
const { ROLES } = require('../config/constants');

const STATE_COOKIE = 'customt_fb_state';
const TTL = { oauth_state: 10 * 60 * 1000, login_code: 60 * 1000, fb_signup: 15 * 60 * 1000, fb_link: 5 * 60 * 1000 };

const isEnabled = () => Boolean(config.facebook.appId && config.facebook.appSecret);
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// ───────────────────────────── Tickets ─────────────────────────────

async function issueTicket(type, { userId, data = {} } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await AuthTicket.create({ tokenHash: sha256(token), type, userId, data, expiresAt: new Date(Date.now() + TTL[type]) });
  return token;
}

/** Atomically marks a ticket used. Returns null if it is unknown, expired, already used or of another type. */
async function consumeTicket(type, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return AuthTicket.findOneAndUpdate(
    { tokenHash: sha256(token), type, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  );
}

async function peekTicket(type, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return AuthTicket.findOne({ tokenHash: sha256(token), type, usedAt: null, expiresAt: { $gt: new Date() } });
}

// ───────────────────────────── Facebook Graph API ─────────────────────────────

const graphBase = () => `https://graph.facebook.com/${config.facebook.graphVersion}`;

const defaultGraph = {
  async exchangeCode(code, redirectUri) {
    const url = new URL(`${graphBase()}/oauth/access_token`);
    url.search = new URLSearchParams({ client_id: config.facebook.appId, client_secret: config.facebook.appSecret, redirect_uri: redirectUri, code }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) throw new Error(body?.error?.message || 'Facebook did not return an access token');
    return body.access_token;
  },
  async fetchProfile(accessToken) {
    // appsecret_proof proves the call comes from our server, so a leaked token alone can't be replayed.
    const proof = crypto.createHmac('sha256', config.facebook.appSecret).update(accessToken).digest('hex');
    const url = new URL(`${graphBase()}/me`);
    url.search = new URLSearchParams({ fields: 'id,name,email', access_token: accessToken, appsecret_proof: proof }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.id) throw new Error(body?.error?.message || 'Facebook did not return a profile');
    return { id: String(body.id), name: body.name || '', email: body.email ? String(body.email).toLowerCase().trim() : null };
  },
};
let graph = defaultGraph;

// ───────────────────────────── URLs and cookies ─────────────────────────────

function apiBase(req) {
  return config.publicApiUrl || `${req.protocol}://${req.get('host')}`;
}
const callbackUrl = (req) => `${apiBase(req)}/api/auth/facebook/callback`;

/** Where the web app should land (only our own app URL, never a URL from the request). */
function appRedirect(path, params = {}) {
  const url = new URL(path, `${config.appUrl}/`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function stateCookie(value, maxAgeMs) {
  const parts = [`${STATE_COOKIE}=${encodeURIComponent(value)}`, 'Path=/api/auth/facebook', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (config.isProduction) parts.push('Secure');
  return parts.join('; ');
}

// ───────────────────────────── Flow ─────────────────────────────

/** Step 1: returns the Facebook dialog URL and the cookie to set. `linkTicket` = link Facebook to a signed-in user. */
async function startLogin(req, { linkTicket } = {}) {
  if (!isEnabled()) return { redirect: appRedirect('/login', { oauthError: 'unavailable' }) };
  let linkUserId = null;
  if (linkTicket) {
    const ticket = await consumeTicket('fb_link', linkTicket);
    if (!ticket) return { redirect: appRedirect('/account', { facebook: 'link_expired' }) };
    linkUserId = ticket.userId;
  }
  const state = await issueTicket('oauth_state', { data: { linkUserId: linkUserId ? String(linkUserId) : null } });
  const dialog = new URL(`https://www.facebook.com/${config.facebook.graphVersion}/dialog/oauth`);
  dialog.search = new URLSearchParams({
    client_id: config.facebook.appId,
    redirect_uri: callbackUrl(req),
    state,
    response_type: 'code',
    scope: 'public_profile,email',
  }).toString();
  return { redirect: dialog.toString(), cookie: stateCookie(state, TTL.oauth_state) };
}

const fail = (reason, path = '/login') => ({ redirect: appRedirect(path, { oauthError: reason }), clearCookie: true });

/** Step 2: Facebook redirected back. Returns where to send the browser next. */
async function handleCallback(req) {
  if (!isEnabled()) return fail('unavailable');
  const { code, state, error } = req.query;
  if (error) return fail(error === 'access_denied' ? 'cancelled' : 'facebook_error');

  // CSRF: the state must be ours AND come back to the same browser that started the flow.
  const cookieState = readCookie(req, STATE_COOKIE);
  if (!state || !cookieState || typeof state !== 'string' || state !== cookieState) return fail('state_mismatch');
  const stateTicket = await consumeTicket('oauth_state', state);
  if (!stateTicket) return fail('state_mismatch');
  const linkUserId = stateTicket.data?.linkUserId;
  if (typeof code !== 'string' || !code) return fail('facebook_error');

  let profile;
  try {
    const token = await graph.exchangeCode(code, callbackUrl(req));
    profile = await graph.fetchProfile(token);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[facebook] login failed:', err.message);
    return fail('facebook_error', linkUserId ? '/account' : '/login');
  }

  const linked = await User.findOne({ 'oauth.facebook.id': profile.id });

  // Linking Facebook to a signed-in account (started from the Account page).
  if (linkUserId) {
    if (linked && String(linked._id) !== linkUserId) return fail('facebook_in_use', '/account');
    const user = await User.findById(linkUserId);
    if (!user || !user.isActive) return fail('account_unavailable', '/account');
    user.set('oauth.facebook', { id: profile.id, linkedAt: new Date() });
    await user.save({ validateModifiedOnly: true });
    return { redirect: appRedirect('/account', { facebook: 'linked' }), clearCookie: true };
  }

  if (linked) {
    if (!linked.isActive) return fail('suspended');
    const loginCode = await issueTicket('login_code', { userId: linked._id });
    return { redirect: appRedirect('/auth/callback', { code: loginCode }), clearCookie: true };
  }

  if (!profile.email) return fail('no_email');
  if (await User.exists({ email: profile.email })) return fail('email_exists');

  const signup = await issueTicket('fb_signup', { data: { facebookId: profile.id, name: profile.name.slice(0, 100), email: profile.email } });
  return { redirect: appRedirect('/auth/facebook/complete', { ticket: signup }), clearCookie: true };
}

/** Step 3: POST /api/auth/exchange { code } -> the user for whom a session token is issued. */
async function exchangeLoginCode(code) {
  const ticket = await consumeTicket('login_code', code);
  if (!ticket) throw ApiError.unauthorized('This sign-in link has expired. Please try again.', { code: 'LOGIN_CODE_INVALID' });
  const user = await User.findById(ticket.userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (!user.isActive) throw ApiError.forbidden('Your account has been suspended. Please contact support.', { code: 'ACCOUNT_SUSPENDED' });
  user.lastLoginAt = new Date();
  await user.save({ validateModifiedOnly: true });
  return user;
}

/** GET /api/auth/facebook/signup?ticket= : shows the name and e-mail Facebook gave (without using the ticket). */
async function signupPreview(ticketToken) {
  const ticket = await peekTicket('fb_signup', ticketToken);
  if (!ticket) throw ApiError.badRequest('This sign-up link has expired. Please continue with Facebook again.', { code: 'SIGNUP_TICKET_INVALID' });
  return { name: ticket.data.name, email: ticket.data.email };
}

/** POST /api/auth/facebook/complete { ticket, name, phone } -> creates the BUYER account. */
async function completeSignup({ ticket: ticketToken, name, phone }, { assertCleanDisplayName }) {
  const preview = await peekTicket('fb_signup', ticketToken);
  if (!preview) throw ApiError.badRequest('This sign-up link has expired. Please continue with Facebook again.', { code: 'SIGNUP_TICKET_INVALID' });
  const cleanName = typeof name === 'string' && name.trim() ? name.trim() : preview.data.name;
  assertCleanDisplayName('Name', cleanName);
  // Validate before using up the ticket, so a typo in the phone number doesn't force a new Facebook round-trip.
  const draft = new User({ name: cleanName, email: preview.data.email, phone, role: ROLES.BUYER, oauth: { facebook: { id: preview.data.facebookId, linkedAt: new Date() } } });
  await draft.validate();
  if (await User.exists({ email: preview.data.email })) throw ApiError.conflict('An account with this e-mail already exists. Sign in with your password, then link Facebook from your account page.');
  if (await User.exists({ 'oauth.facebook.id': preview.data.facebookId })) throw ApiError.conflict('This Facebook account is already linked to a CustomT account.');

  const ticket = await consumeTicket('fb_signup', ticketToken);
  if (!ticket) throw ApiError.badRequest('This sign-up link has already been used.', { code: 'SIGNUP_TICKET_INVALID' });
  await draft.save();
  return draft;
}

/** POST /api/auth/facebook/link : one-time ticket so the browser can start the Facebook redirect while signed in. */
async function createLinkTicket(user) {
  if (!isEnabled()) throw ApiError.serviceUnavailable('Facebook Login is not configured', { code: 'FACEBOOK_UNAVAILABLE' });
  if (user.oauth?.facebook?.id) throw ApiError.conflict('Facebook is already linked to your account');
  // The web app navigates to `${API_URL}/api/auth/facebook?link=<ticket>`.
  return { ticket: await issueTicket('fb_link', { userId: user._id }) };
}

/** DELETE /api/auth/facebook : unlink; only if the account has a password, so nobody locks themselves out. */
async function unlink(userId) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user?.oauth?.facebook?.id) throw ApiError.badRequest('Facebook is not linked to your account');
  if (!user.passwordHash) {
    throw ApiError.conflict('Set a password first (use "Forgot password" on the sign-in page), so you can still sign in after unlinking.', { code: 'PASSWORD_REQUIRED' });
  }
  user.set('oauth.facebook', undefined);
  await user.save({ validateModifiedOnly: true });
  return user;
}

module.exports = {
  STATE_COOKIE,
  isEnabled,
  startLogin,
  handleCallback,
  exchangeLoginCode,
  signupPreview,
  completeSignup,
  createLinkTicket,
  unlink,
  stateCookie,
  // Test hooks
  _setGraphClient: (client) => {
    graph = client || defaultGraph;
  },
  _issueTicket: issueTicket,
};
