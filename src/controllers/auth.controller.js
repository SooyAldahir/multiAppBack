const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { HttpError, asyncHandler } = require('../utils/http');
const { validate } = require('../utils/validator');
const schemas = require('../validators/schemas');
const social = require('../services/social-auth.service');

const { publicUser, loadUser, me } = require('./users.controller');

const register = asyncHandler(async (req, res) => {
  const { name, email, password } = validate(schemas.register, req.body);

  const exists = await query('SELECT 1 FROM dbo.Users WHERE Email = @email', { email });
  if (exists.recordset.length > 0) throw new HttpError(409, 'Ya existe una cuenta con ese correo');

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query(
    `INSERT INTO dbo.Users (Name, Email, PasswordHash)
     OUTPUT INSERTED.Id, INSERTED.Name, INSERTED.Email, INSERTED.CreatedAt
     VALUES (@name, @email, @passwordHash)`,
    { name, email, passwordHash },
  );
  const user = publicUser(result.recordset[0]);
  res.status(201).json({ token: signToken(user), user });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = validate(schemas.login, req.body);
  const result = await query('SELECT * FROM dbo.Users WHERE Email = @email', { email });
  const row = result.recordset[0];
  if (row && !row.PasswordHash) {
    throw new HttpError(401, 'Esta cuenta se creó con Google o Apple: entra con ese botón.');
  }
  const ok = row && (await bcrypt.compare(password, row.PasswordHash));
  if (!ok) throw new HttpError(401, 'Correo o contraseña incorrectos');
  const user = publicUser(row);
  res.json({ token: signToken(user), user });
});

/** Nombre para una cuenta nueva: el que manda Apple/Google o la parte antes de la @. */
function displayName(...candidates) {
  for (const c of candidates) {
    const v = typeof c === 'string' ? c.trim().replace(/\s+/g, ' ') : '';
    if (v.length >= 2) return v.slice(0, 100);
  }
  return 'Usuario';
}

/**
 * Busca (o crea) el usuario de una cuenta de Google/Apple.
 * - Si esa cuenta ya estaba vinculada → ese usuario.
 * - Si no, pero ya existe un usuario con el mismo correo (verificado por el proveedor) → se vincula.
 * - Si no → se crea un usuario nuevo sin contraseña.
 */
async function findOrCreateUser(provider, claims, nameHint) {
  const linked = await query(
    'SELECT UserId FROM dbo.UserIdentities WHERE Provider = @provider AND Subject = @subject',
    { provider, subject: claims.sub },
  );
  if (linked.recordset[0]) return { userId: linked.recordset[0].UserId, created: false, identityExists: true };

  if (!claims.email) {
    throw new HttpError(400, 'No recibimos tu correo. Intenta de nuevo y permite compartir tu correo.');
  }

  let userId;
  let created = false;
  const existing = await query('SELECT Id FROM dbo.Users WHERE Email = @email', { email: claims.email });
  if (existing.recordset[0]) {
    userId = existing.recordset[0].Id;
  } else {
    const inserted = await query(
      `INSERT INTO dbo.Users (Name, Email, PasswordHash)
       OUTPUT INSERTED.Id
       VALUES (@name, @email, NULL)`,
      { name: displayName(nameHint, claims.name, claims.email.split('@')[0]), email: claims.email },
    );
    userId = inserted.recordset[0].Id;
    created = true;
  }
  await query(
    `INSERT INTO dbo.UserIdentities (UserId, Provider, Subject, Email)
     VALUES (@userId, @provider, @subject, @email)`,
    { userId, provider, subject: claims.sub, email: claims.email },
  );
  return { userId, created, identityExists: false };
}

function socialLogin(provider) {
  return asyncHandler(async (req, res) => {
    const body = validate(schemas.socialLogin, req.body);
    const claims = await social.verifyIdToken(provider, body.idToken);
    const { userId, created } = await findOrCreateUser(provider, claims, body.name);

    // Apple: guardar el refresh token para poder revocarlo si la persona elimina su cuenta.
    if (provider === 'apple' && body.authorizationCode) {
      try {
        const refreshToken = await social.appleExchangeCode(body.authorizationCode);
        if (refreshToken) {
          await query(
            'UPDATE dbo.UserIdentities SET RefreshToken = @refreshToken WHERE Provider = @provider AND Subject = @subject',
            { refreshToken, provider, subject: claims.sub },
          );
        }
      } catch (err) {
        console.warn('Apple: no se pudo canjear el código:', err.message);
      }
    }

    const user = await loadUser(userId);
    res.status(created ? 201 : 200).json({ token: signToken(user), user, created });
  });
}

module.exports = {
  register,
  login,
  me,
  google: socialLogin('google'),
  apple: socialLogin('apple'),
  findOrCreateUser,
  displayName,
};
