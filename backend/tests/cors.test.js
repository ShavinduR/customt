const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-'.repeat(4);
process.env.CLIENT_URL = 'https://customt.vercel.app';
delete process.env.NATIVE_APP_ORIGINS; // default: the Android app's https://localhost

const { createApp } = require('../server');

async function preflight(origin) {
  const server = createApp().listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' },
    });
    return res.headers.get('access-control-allow-origin');
  } finally {
    server.close();
  }
}

test('CORS allows the web frontend and the Android app (https://localhost), nothing else', async () => {
  assert.equal(await preflight('https://customt.vercel.app'), 'https://customt.vercel.app');
  assert.equal(await preflight('https://localhost'), 'https://localhost');
  assert.equal(await preflight('https://evil.example'), null);
  assert.equal(await preflight('http://localhost'), null, 'only the HTTPS scheme the app uses');
});
