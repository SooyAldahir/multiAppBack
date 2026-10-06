/** Perfil completo del usuario: datos, foto, seguridad, preferencias y dispositivos. */
const bcrypt = require('bcryptjs');
const { sql, query } = require('../config/db');
const { env } = require('../config/env');
const { signToken } = require('../middleware/auth');
const { HttpError, asyncHandler, toPascal } = require('../utils/http');
const { validate } = require('../utils/validator');
const schemas = require('../validators/schemas');
const cloudinary = require('../services/cloudinary.service');
const notifications = require('../services/notifications.service');
const fcm = require('../services/fcm.service');

const USER_COLUMNS = 'Id, Name, Email, AvatarUrl, Phone, BirthDate, City, Bio, CreatedAt';

/** Usuario tal como lo ve la app (nunca incluye la contraseña). */
function publicUser(row) {
  return {
    id: row.Id,
    name: row.Name,
    email: row.Email,
    avatarUrl: row.AvatarUrl ?? null,
    phone: row.Phone ?? null,
    birthDate: row.BirthDate ? new Date(row.BirthDate).toISOString().slice(0, 10) : null,
    city: row.City ?? null,
    bio: row.Bio ?? null,
    createdAt: row.CreatedAt,
  };
}

async function loadUser(id) {
  const r = await query(`SELECT ${USER_COLUMNS} FROM dbo.Users WHERE Id = @id`, { id });
  if (!r.recordset[0]) throw new HttpError(404, 'Usuario no encontrado');
  return publicUser(r.recordset[0]);
}

async function checkPassword(userId, password) {
  const r = await query('SELECT PasswordHash FROM dbo.Users WHERE Id = @id', { id: userId });
  const ok = r.recordset[0] && (await bcrypt.compare(password, r.recordset[0].PasswordHash));
  if (!ok) throw new HttpError(403, 'La contraseña actual no es correcta');
}

// GET /api/users/me
const me = asyncHandler(async (req, res) => {
  res.json(await loadUser(req.user.id));
});

// PATCH /api/users/me { name?, phone?, birthDate?, city?, bio? }
const updateMe = asyncHandler(async (req, res) => {
  const data = validate(schemas.profileUpdate, req.body, { partial: true });
  if (data.birthDate && data.birthDate > new Date()) throw new HttpError(400, 'La fecha de nacimiento no puede ser futura');
  const types = { birthDate: sql.Date };
  const params = { id: req.user.id };
  const sets = Object.keys(data).map((k) => {
    params[k] = types[k] ? [types[k], data[k]] : data[k];
    return `${toPascal(k)} = @${k}`;
  });
  await query(`UPDATE dbo.Users SET ${sets.join(', ')}, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id`, params);
  res.json(await loadUser(req.user.id));
});

// POST /api/users/me/avatar { image: base64 | dataURI }
const uploadAvatar = asyncHandler(async (req, res) => {
  if (!cloudinary.isConfigured()) {
    throw new HttpError(503, 'Las fotos de perfil no están configuradas (falta CLOUDINARY_URL en el .env)');
  }
  const { image } = validate(schemas.avatarUpload, req.body);
  const dataUri = image.startsWith('data:image/') ? image : `data:image/jpeg;base64,${image}`;
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  if (base64.length * 0.75 > 6 * 1024 * 1024) throw new HttpError(413, 'La foto es muy pesada (máx. 6 MB)');

  // Una foto por usuario: se sobrescribe la anterior.
  const url = await cloudinary.uploadImage(dataUri, {
    folder: `${env.cloudinary.folder}/avatars`,
    publicId: `user_${req.user.id}`,
    overwrite: true,
  });
  // La URL de Cloudinary incluye la versión (/v123/), así el teléfono no muestra la foto vieja en caché.
  const avatar = cloudinary.avatarUrl(url);
  await query('UPDATE dbo.Users SET AvatarUrl = @url, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id', {
    id: req.user.id,
    url: [sql.NVarChar(500), avatar],
  });
  res.json(await loadUser(req.user.id));
});

// DELETE /api/users/me/avatar
const deleteAvatar = asyncHandler(async (req, res) => {
  await query('UPDATE dbo.Users SET AvatarUrl = NULL, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id', { id: req.user.id });
  res.json(await loadUser(req.user.id));
});

// PUT /api/users/me/password { currentPassword, newPassword }
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = validate(schemas.passwordChange, req.body);
  await checkPassword(req.user.id, currentPassword);
  if (currentPassword === newPassword) throw new HttpError(400, 'La nueva contraseña debe ser diferente');
  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE dbo.Users SET PasswordHash = @hash, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id', {
    id: req.user.id,
    hash,
  });
  res.json({ ok: true });
});

// PUT /api/users/me/email { email, password }  -> devuelve un token nuevo
const changeEmail = asyncHandler(async (req, res) => {
  const { email, password } = validate(schemas.emailChange, req.body);
  await checkPassword(req.user.id, password);
  const exists = await query('SELECT 1 FROM dbo.Users WHERE Email = @email AND Id <> @id', { email, id: req.user.id });
  if (exists.recordset.length) throw new HttpError(409, 'Ya existe una cuenta con ese correo');
  await query('UPDATE dbo.Users SET Email = @email, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id', {
    id: req.user.id,
    email,
  });
  const user = await loadUser(req.user.id);
  res.json({ token: signToken(user), user });
});

// DELETE /api/users/me { password }  -> borra la cuenta y todos sus datos
const deleteAccount = asyncHandler(async (req, res) => {
  const { password } = validate(schemas.passwordConfirm, req.body || {});
  await checkPassword(req.user.id, password);
  // Todas las tablas tienen ON DELETE CASCADE hacia Users.
  await query('DELETE FROM dbo.Users WHERE Id = @id', { id: req.user.id });
  res.status(204).end();
});

/* ---------------- Notificaciones ---------------- */

// GET /api/users/me/notifications
const getNotificationPrefs = asyncHandler(async (req, res) => {
  const prefs = await notifications.getPrefs(req.user.id);
  res.json({ ...notifications.publicPrefs(prefs), pushAvailable: fcm.isConfigured() });
});

// PUT /api/users/me/notifications
const saveNotificationPrefs = asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') throw new HttpError(400, 'Preferencias inválidas');
  const current = await notifications.getPrefs(req.user.id);
  const prefs = notifications.normalizePrefs(req.body, current);
  await notifications.savePrefs(req.user.id, prefs);
  res.json({ ...notifications.publicPrefs(prefs), pushAvailable: fcm.isConfigured() });
});

// POST /api/devices { token, platform }
const registerDevice = asyncHandler(async (req, res) => {
  const { token, platform } = validate(schemas.deviceRegister, req.body);
  await notifications.registerDevice(req.user.id, token, platform || 'android');
  res.status(201).json({ ok: true });
});

// DELETE /api/devices/:token
const unregisterDevice = asyncHandler(async (req, res) => {
  await notifications.unregisterDevice(req.user.id, String(req.params.token || '').slice(0, 400));
  res.status(204).end();
});

// POST /api/notifications/test  -> push de prueba a mis teléfonos
const testPush = asyncHandler(async (req, res) => {
  if (!fcm.isConfigured()) {
    throw new HttpError(503, 'Las notificaciones push no están configuradas en el servidor (FIREBASE_SERVICE_ACCOUNT)');
  }
  const result = await notifications.sendToUser(req.user.id, {
    title: 'multiApp',
    body: '¡Las notificaciones push funcionan! 🎉',
    data: { type: 'test' },
  });
  if (result.devices === 0) throw new HttpError(404, 'Este teléfono aún no está registrado para recibir push');
  res.json(result);
});

module.exports = {
  publicUser,
  me,
  updateMe,
  uploadAvatar,
  deleteAvatar,
  changePassword,
  changeEmail,
  deleteAccount,
  getNotificationPrefs,
  saveNotificationPrefs,
  registerDevice,
  unregisterDevice,
  testPush,
};
