/**
 * Eliminación definitiva de una cuenta (desde la app o desde la página web pública).
 * 1. Revoca los tokens de Sign in with Apple (lo exige Apple, TN3194).
 * 2. Borra la foto de perfil de Cloudinary.
 * 3. Borra el usuario: todas las tablas tienen ON DELETE CASCADE hacia Users,
 *    así se van agenda, notas, pendientes, gastos, presupuestos, lugares, teléfonos, etc.
 * Los pasos 1 y 2 son "mejor esfuerzo": si fallan se registra y la cuenta se borra igual.
 */
const { query } = require('../config/db');
const social = require('./social-auth.service');
const cloudinary = require('./cloudinary.service');

async function deleteAccount(userId, { log = console } = {}) {
  const identities = await query(
    "SELECT RefreshToken FROM dbo.UserIdentities WHERE UserId = @userId AND Provider = 'apple' AND RefreshToken IS NOT NULL",
    { userId },
  );
  for (const row of identities.recordset) {
    try {
      await social.appleRevoke(row.RefreshToken);
    } catch (err) {
      log.warn(`Apple: no se pudo revocar el token del usuario ${userId}:`, err.message);
    }
  }

  const user = await query('SELECT AvatarUrl FROM dbo.Users WHERE Id = @userId', { userId });
  if (user.recordset[0]?.AvatarUrl) {
    await cloudinary.destroyImage(cloudinary.avatarPublicId(userId));
  }

  await query('DELETE FROM dbo.Users WHERE Id = @userId', { userId });
}

module.exports = { deleteAccount };
