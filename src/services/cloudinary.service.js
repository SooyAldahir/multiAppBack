/**
 * Subida de imágenes a Cloudinary con la API REST firmada (sin SDK).
 * Firma: SHA-1 de los parámetros ordenados "k=v&k=v" + API secret
 * (no se firman file, api_key, cloud_name ni resource_type).
 */
const crypto = require('node:crypto');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http');

function isConfigured() {
  const c = env.cloudinary;
  return Boolean(c.cloudName && c.apiKey && c.apiSecret);
}

function sign(params, secret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + secret).digest('hex');
}

/**
 * Sube una imagen (data URI "data:image/jpeg;base64,...") y devuelve su URL segura.
 * Si Cloudinary no está configurado devuelve null (la app funciona igual, solo sin guardar la foto).
 */
async function uploadImage(dataUri, { folder, publicId, overwrite, fetchImpl = fetch } = {}) {
  if (!isConfigured()) return null;
  const c = env.cloudinary;
  const params = { folder: folder || c.folder, timestamp: Math.floor(Date.now() / 1000) };
  if (publicId) params.public_id = publicId;
  if (overwrite) {
    params.overwrite = 'true';
    params.invalidate = 'true';
  }
  const form = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    file: dataUri,
    api_key: c.apiKey,
    signature: sign(params, c.apiSecret),
  });

  let res;
  try {
    res = await fetchImpl(`https://api.cloudinary.com/v1_1/${c.cloudName}/image/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    console.error('Cloudinary (red):', err.message);
    throw new HttpError(502, 'No se pudo subir la foto');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Cloudinary respondió', res.status, data?.error?.message);
    throw new HttpError(502, 'No se pudo subir la foto (revisa la configuración de Cloudinary)');
  }
  return data.secure_url;
}

/** URL recortada a un cuadrado centrado en la cara (para fotos de perfil). */
function avatarUrl(secureUrl, size = 256) {
  if (!secureUrl) return null;
  return secureUrl.replace('/upload/', `/upload/c_fill,g_face,w_${size},h_${size},q_auto,f_auto/`);
}

/**
 * Borra una imagen de Cloudinary (p. ej. la foto de perfil al eliminar la cuenta).
 * Devuelve true si se borró o ya no existía. Nunca lanza: un fallo aquí no debe impedir borrar la cuenta.
 */
async function destroyImage(publicId, { fetchImpl = fetch } = {}) {
  if (!isConfigured() || !publicId) return false;
  const c = env.cloudinary;
  const params = { public_id: publicId, invalidate: 'true', timestamp: Math.floor(Date.now() / 1000) };
  const form = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    api_key: c.apiKey,
    signature: sign(params, c.apiSecret),
  });
  try {
    const res = await fetchImpl(`https://api.cloudinary.com/v1_1/${c.cloudName}/image/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && (data.result === 'ok' || data.result === 'not found');
  } catch (err) {
    console.warn('Cloudinary: no se pudo borrar la imagen:', err.message);
    return false;
  }
}

/** public_id de la foto de perfil de un usuario. */
function avatarPublicId(userId) {
  return `${env.cloudinary.folder}/avatars/user_${userId}`;
}

module.exports = { uploadImage, destroyImage, avatarPublicId, isConfigured, sign, avatarUrl };
