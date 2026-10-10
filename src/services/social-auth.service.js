/**
 * Inicio de sesión con Google y Apple.
 *
 * La app obtiene un "ID token" (un JWT firmado por Google o Apple) y lo manda al servidor.
 * Aquí se verifica la firma con las llaves públicas del proveedor (JWKS), el emisor, la audiencia
 * (nuestros IDs de cliente) y la vigencia. Sin dependencias extra: node:crypto + jsonwebtoken.
 *
 * Apple además exige que, al eliminar una cuenta, se revoquen sus tokens (TN3194). Para eso, al
 * iniciar sesión se canjea el "authorization code" por un refresh token y se guarda; al borrar
 * la cuenta se revoca. Requiere la llave de Sign in with Apple (APPLE_TEAM_ID, APPLE_KEY_ID,
 * APPLE_PRIVATE_KEY). Si no está configurada, el inicio de sesión funciona igual, solo sin revocar.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http');

const PROVIDERS = {
  google: {
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['accounts.google.com', 'https://accounts.google.com'],
    audiences: () => env.social.googleClientIds,
    label: 'Google',
  },
  apple: {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    audiences: () => env.social.appleClientIds,
    label: 'Apple',
  },
};

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map(); // url → { at, keys }

async function getKeys(url, fetchImpl, force = false) {
  const cached = jwksCache.get(url);
  if (!force && cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`JWKS ${url} respondió ${res.status}`);
  const { keys } = await res.json();
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}

async function findKey(provider, kid, fetchImpl) {
  let keys = await getKeys(provider.jwksUrl, fetchImpl);
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Los proveedores rotan sus llaves: se recarga una vez.
    keys = await getKeys(provider.jwksUrl, fetchImpl, true);
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new HttpError(401, 'No se pudo verificar tu sesión. Intenta de nuevo.');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

/**
 * Verifica un ID token y devuelve sus datos { sub, email, emailVerified, name, iat }.
 * Lanza HttpError 401 si no es válido.
 */
async function verifyIdToken(providerName, idToken, { fetchImpl = fetch } = {}) {
  const provider = PROVIDERS[providerName];
  if (!provider) throw new HttpError(400, 'Proveedor no soportado');
  const audiences = provider.audiences();
  if (!audiences.length) {
    throw new HttpError(503, `El inicio de sesión con ${provider.label} no está configurado en el servidor`);
  }
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) {
    throw new HttpError(400, `Token de ${provider.label} inválido`);
  }
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw new HttpError(401, `Token de ${provider.label} inválido`);

  let claims;
  try {
    const key = await findKey(provider, decoded.header.kid, fetchImpl);
    claims = jwt.verify(idToken, key, {
      algorithms: ['RS256'],
      issuer: provider.issuers,
      audience: audiences,
      clockTolerance: 60,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.name === 'TokenExpiredError') throw new HttpError(401, `Tu sesión de ${provider.label} expiró. Intenta de nuevo.`);
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
      throw new HttpError(401, `No se pudo verificar tu cuenta de ${provider.label}`);
    }
    console.error(`Verificación ${provider.label}:`, err.message);
    throw new HttpError(502, `No se pudo contactar a ${provider.label}. Intenta de nuevo.`);
  }

  const verified = claims.email_verified === true || claims.email_verified === 'true';
  return {
    sub: String(claims.sub),
    email: claims.email && verified ? String(claims.email).toLowerCase() : null,
    emailVerified: verified,
    name: typeof claims.name === 'string' ? claims.name : null,
    iat: Number(claims.iat) || 0,
  };
}

/* ---------------- Apple: canje y revocación de tokens ---------------- */

function applePrivateKey() {
  const a = env.social.apple;
  if (a.privateKey) return a.privateKey.replace(/\\n/g, '\n');
  if (a.privateKeyPath) {
    try {
      return fs.readFileSync(a.privateKeyPath, 'utf8');
    } catch {
      return '';
    }
  }
  return '';
}

function appleRevocationConfigured() {
  const a = env.social.apple;
  return Boolean(a.teamId && a.keyId && env.social.appleClientIds[0] && applePrivateKey());
}

/** "client_secret" que pide Apple: un JWT ES256 firmado con la llave .p8 de Sign in with Apple. */
function appleClientSecret(clientId = env.social.appleClientIds[0]) {
  const a = env.social.apple;
  return jwt.sign({}, applePrivateKey(), {
    algorithm: 'ES256',
    keyid: a.keyId,
    issuer: a.teamId,
    audience: 'https://appleid.apple.com',
    subject: clientId,
    expiresIn: '5m',
  });
}

async function applePost(path, params, fetchImpl) {
  const clientId = env.social.appleClientIds[0];
  const body = new URLSearchParams({ client_id: clientId, client_secret: appleClientSecret(clientId), ...params });
  const res = await fetchImpl(`https://appleid.apple.com/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apple /auth/${path} respondió ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/** Canjea el authorization code de Apple por un refresh token (null si no está configurado). */
async function appleExchangeCode(code, { fetchImpl = fetch } = {}) {
  if (!code || !appleRevocationConfigured()) return null;
  const r = await applePost('token', { code, grant_type: 'authorization_code' }, fetchImpl);
  return r.refresh_token || null;
}

/** Revoca el refresh token de Apple (al eliminar la cuenta). Devuelve true si se revocó. */
async function appleRevoke(refreshToken, { fetchImpl = fetch } = {}) {
  if (!refreshToken || !appleRevocationConfigured()) return false;
  await applePost('revoke', { token: refreshToken, token_type_hint: 'refresh_token' }, fetchImpl);
  return true;
}

function _resetCache() {
  jwksCache.clear();
}

module.exports = {
  verifyIdToken,
  appleExchangeCode,
  appleRevoke,
  appleRevocationConfigured,
  appleClientSecret,
  PROVIDERS,
  _resetCache,
};
