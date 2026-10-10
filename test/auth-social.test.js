/** Google / Apple, eliminación de cuenta y páginas públicas. */
process.env.GOOGLE_CLIENT_IDS = 'web-client.apps.googleusercontent.com';
process.env.APPLE_CLIENT_IDS = 'com.aldahirballina.multiapp';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { calls, setResult, resetCalls, run } = require('./helpers');
const social = require('../src/services/social-auth.service');
const auth = require('../src/controllers/auth.controller');
const users = require('../src/controllers/users.controller');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const fakeFetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });

function idToken(claims, { kid = 'k1', key = privateKey } = {}) {
  return jwt.sign(claims, key, { algorithm: 'RS256', keyid: kid, expiresIn: '10m' });
}

const googleClaims = {
  iss: 'https://accounts.google.com',
  aud: 'web-client.apps.googleusercontent.com',
  sub: 'g-123',
  email: 'Ana@Gmail.com',
  email_verified: true,
  name: 'Ana López',
};

test('social: verifica un ID token de Google válido', async () => {
  social._resetCache();
  const c = await social.verifyIdToken('google', idToken(googleClaims), { fetchImpl: fakeFetch });
  assert.equal(c.sub, 'g-123');
  assert.equal(c.email, 'ana@gmail.com');
  assert.equal(c.name, 'Ana López');
});

test('social: rechaza audiencia ajena, firma falsa y emisor incorrecto', async () => {
  social._resetCache();
  const opts = { fetchImpl: fakeFetch };
  await assert.rejects(social.verifyIdToken('google', idToken({ ...googleClaims, aud: 'otra-app' }), opts), { status: 401 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(social.verifyIdToken('google', idToken(googleClaims, { key: other }), opts), { status: 401 });
  await assert.rejects(
    social.verifyIdToken('apple', idToken({ ...googleClaims, aud: 'com.aldahirballina.multiapp' }), opts),
    { status: 401 },
  );
  await assert.rejects(social.verifyIdToken('google', 'basura', opts), { status: 400 });
});

test('social: correo no verificado no se usa', async () => {
  social._resetCache();
  const c = await social.verifyIdToken('google', idToken({ ...googleClaims, email_verified: false }), { fetchImpl: fakeFetch });
  assert.equal(c.email, null);
});

test('social: Apple acepta el bundle ID como audiencia', async () => {
  social._resetCache();
  const token = idToken({ iss: 'https://appleid.apple.com', aud: 'com.aldahirballina.multiapp', sub: 'a-1', email: 'x@privaterelay.appleid.com', email_verified: 'true' });
  const c = await social.verifyIdToken('apple', token, { fetchImpl: fakeFetch });
  assert.equal(c.email, 'x@privaterelay.appleid.com');
});

test('findOrCreateUser: cuenta ya vinculada devuelve el mismo usuario', async () => {
  resetCalls();
  setResult({ recordset: [{ UserId: 42 }] });
  const r = await auth.findOrCreateUser('google', { sub: 'g-1', email: 'a@b.com' });
  assert.deepEqual(r, { userId: 42, created: false, identityExists: true });
  assert.equal(calls.length, 1);
});

test('findOrCreateUser: vincula con un usuario existente del mismo correo', async () => {
  resetCalls();
  setResult((text) => {
    if (text.includes('FROM dbo.UserIdentities')) return { recordset: [] };
    if (text.includes('SELECT Id FROM dbo.Users')) return { recordset: [{ Id: 9 }] };
    return { recordset: [], rowsAffected: [1] };
  });
  const r = await auth.findOrCreateUser('google', { sub: 'g-2', email: 'ana@gmail.com' });
  assert.equal(r.userId, 9);
  assert.equal(r.created, false);
  assert.ok(calls.some((c) => c.text.startsWith('INSERT INTO dbo.UserIdentities') && c.params.userId === 9));
  assert.ok(!calls.some((c) => c.text.startsWith('INSERT INTO dbo.Users')));
});

test('findOrCreateUser: crea usuario sin contraseña con el nombre de Apple', async () => {
  resetCalls();
  setResult((text) => {
    if (text.includes('INSERT INTO dbo.Users')) return { recordset: [{ Id: 77 }] };
    return { recordset: [], rowsAffected: [1] };
  });
  const r = await auth.findOrCreateUser('apple', { sub: 'a-9', email: 'x@privaterelay.appleid.com' }, 'Luis Pérez');
  assert.deepEqual(r, { userId: 77, created: true, identityExists: false });
  const insert = calls.find((c) => c.text.startsWith('INSERT INTO dbo.Users'));
  assert.match(insert.text, /NULL\)/);
  assert.equal(insert.params.name, 'Luis Pérez');
});

test('findOrCreateUser: sin correo y sin cuenta previa pide compartir el correo', async () => {
  resetCalls();
  setResult({ recordset: [] });
  await assert.rejects(auth.findOrCreateUser('apple', { sub: 'a-0', email: null }), { status: 400 });
});

test('displayName: usa el primer nombre válido', () => {
  assert.equal(auth.displayName('', null, 'ana.lopez'), 'ana.lopez');
  assert.equal(auth.displayName('  Ana   López '), 'Ana López');
  assert.equal(auth.displayName(), 'Usuario');
});

test('login: cuenta de Google sin contraseña da un mensaje claro', async () => {
  setResult({ recordset: [{ Id: 1, Name: 'A', Email: 'a@b.com', PasswordHash: null }] });
  const r = await run(auth.login, { body: { email: 'a@b.com', password: 'loquesea123' } });
  assert.equal(r.error.status, 401);
  assert.match(r.error.message, /Google o Apple/);
});

test('eliminar cuenta: sin contraseña ni token responde 400', async () => {
  const r = await run(users.deleteAccount, { body: {} });
  assert.equal(r.error.status, 400);
});

test('eliminar cuenta: con token de Google de otra cuenta responde 403', async () => {
  social._resetCache();
  const original = global.fetch;
  global.fetch = fakeFetch;
  try {
    resetCalls();
    setResult({ recordset: [] }); // no hay vínculo con ese sub
    const r = await run(users.deleteAccount, { body: { provider: 'google', idToken: idToken(googleClaims) } });
    assert.equal(r.error.status, 403);
    assert.ok(!calls.some((c) => c.text.startsWith('DELETE FROM dbo.Users')));
  } finally {
    global.fetch = original;
  }
});

test('eliminar cuenta: re-autenticación con Google borra al usuario', async () => {
  social._resetCache();
  const original = global.fetch;
  global.fetch = fakeFetch;
  try {
    resetCalls();
    setResult((text) => {
      if (text.includes('SELECT 1 FROM dbo.UserIdentities')) return { recordset: [{ x: 1 }] };
      return { recordset: [], rowsAffected: [1] };
    });
    const r = await run(users.deleteAccount, { body: { provider: 'google', idToken: idToken(googleClaims) } });
    assert.equal(r.status, 204);
    const del = calls.find((c) => c.text.startsWith('DELETE FROM dbo.Users'));
    assert.equal(del.params.userId, 7);
  } finally {
    global.fetch = original;
  }
});

test('cambiar contraseña: cuenta sin contraseña puede crear una', async () => {
  resetCalls();
  setResult((text) => (text.startsWith('SELECT PasswordHash') ? { recordset: [{ PasswordHash: null }] } : { recordset: [], rowsAffected: [1] }));
  const r = await run(users.changePassword, { body: { newPassword: 'nuevaClave123' } });
  assert.equal(r.status, 200);
  assert.ok(calls.some((c) => c.text.startsWith('UPDATE dbo.Users SET PasswordHash')));
});

test('publicUser: indica si tiene contraseña y sus proveedores', () => {
  assert.equal(users.publicUser({ Id: 1, Name: 'A', Email: 'a', HasPassword: 0, providers: ['google'] }).hasPassword, false);
  assert.deepEqual(users.publicUser({ Id: 1, Name: 'A', Email: 'a', HasPassword: 0, providers: ['google'] }).providers, ['google']);
  assert.equal(users.publicUser({ Id: 1, Name: 'A', Email: 'a' }).hasPassword, true);
});

test('apple: sin llave configurada no intenta revocar', async () => {
  assert.equal(social.appleRevocationConfigured(), false);
  assert.equal(await social.appleRevoke('rt'), false);
  assert.equal(await social.appleExchangeCode('code'), null);
});

/* ---------------- Páginas públicas ---------------- */

function get(server, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { port, path, method, headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('páginas legales y archivos .well-known', async () => {
  const app = require('../src/app');
  const server = app.listen(0);
  try {
    for (const path of ['/privacidad', '/terminos', '/eliminar-cuenta', '/soporte']) {
      const r = await get(server, path);
      assert.equal(r.status, 200, path);
      assert.match(r.type, /html/);
      assert.match(r.body, /MultiApp/);
    }
    const priv = await get(server, '/privacidad');
    assert.match(priv.body, /Derechos ARCO/);
    assert.match(priv.body, /Groq/);

    const aasa = await get(server, '/.well-known/apple-app-site-association');
    assert.deepEqual(JSON.parse(aasa.body), { webcredentials: { apps: ['BR8MSB248A.com.aldahirballina.multiapp'] } });

    const links = await get(server, '/.well-known/assetlinks.json');
    assert.deepEqual(JSON.parse(links.body), []);

    setResult({ recordset: [] });
    const bad = await get(server, '/eliminar-cuenta', { method: 'POST', body: 'email=a%40b.com&password=x&confirm=yes' });
    assert.equal(bad.status, 401);
    assert.match(bad.body, /incorrectos/);

    const missing = await get(server, '/eliminar-cuenta', { method: 'POST', body: 'email=a%40b.com' });
    assert.equal(missing.status, 400);
  } finally {
    server.close();
  }
});
