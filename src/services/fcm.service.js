/**
 * Notificaciones push con Firebase Cloud Messaging (API HTTP v1) sin instalar firebase-admin.
 *
 * Configuración (.env), una de las dos:
 *   FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json   (ruta al archivo)
 *   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...} (contenido en una línea)
 *
 * Flujo: se firma un JWT con la llave privada de la cuenta de servicio (RS256), se cambia por un
 * access token de Google (válido 1 h, se guarda en memoria) y se llama a messages:send.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { env } = require('../config/env');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let account; // cuenta de servicio cargada (o null si no hay)
let cachedToken = null; // { value, expiresAt }

function loadAccount() {
  if (account !== undefined) return account;
  account = null;
  try {
    let raw = env.firebase.serviceAccountJson;
    if (!raw && env.firebase.serviceAccountPath) {
      raw = fs.readFileSync(path.resolve(env.firebase.serviceAccountPath), 'utf8');
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.client_email && parsed.private_key && parsed.project_id) account = parsed;
      else console.warn('FCM: la cuenta de servicio no tiene client_email, private_key o project_id');
    }
  } catch (err) {
    console.warn('FCM: no se pudo leer la cuenta de servicio de Firebase:', err.message);
  }
  return account;
}

function isConfigured() {
  return Boolean(loadAccount());
}

/** Solo para pruebas: permite inyectar o limpiar la cuenta. */
function _setAccount(a) {
  account = a;
  cachedToken = null;
}

function buildJwt(acc, now = Math.floor(Date.now() / 1000)) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const payload = b64({
    iss: acc.client_email,
    scope: SCOPE,
    aud: acc.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(acc.private_key, 'base64url');
  return `${header}.${payload}.${signature}`;
}

async function getAccessToken(fetchImpl = fetch) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value;
  const acc = loadAccount();
  const res = await fetchImpl(acc.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildJwt(acc),
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google OAuth respondió ${res.status}: ${data.error_description || data.error || 'sin token'}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

/**
 * Envía una notificación a un token.
 * Devuelve { ok: true } | { ok: false, invalidToken: boolean, error }.
 */
async function sendToToken(token, { title, body, data = {} }, { fetchImpl = fetch } = {}) {
  const acc = loadAccount();
  if (!acc) return { ok: false, invalidToken: false, error: 'FCM no configurado' };

  const accessToken = await getAccessToken(fetchImpl);
  const message = {
    token,
    notification: { title, body },
    // FCM solo acepta valores de texto en "data".
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    android: { priority: 'high', notification: { channel_id: 'multiapp_general' } },
    apns: { payload: { aps: { sound: 'default' } } },
  };

  const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return { ok: true };

  const err = await res.json().catch(() => ({}));
  const status = err?.error?.status || '';
  const details = JSON.stringify(err?.error?.details || []);
  // El token ya no existe (app desinstalada, sesión cerrada…): hay que borrarlo.
  const invalidToken = status === 'NOT_FOUND' || /UNREGISTERED|INVALID_ARGUMENT/.test(details) || res.status === 404;
  return { ok: false, invalidToken, error: err?.error?.message || `FCM respondió ${res.status}` };
}

/** Cuenta cargada (solo para diagnósticos; nunca imprimir la llave privada). */
const _account = () => loadAccount();

module.exports = { isConfigured, sendToToken, getAccessToken, buildJwt, _setAccount, _account };
