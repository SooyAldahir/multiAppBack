const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { HttpError, asyncHandler } = require('../utils/http');
const { validate } = require('../utils/validator');
const schemas = require('../validators/schemas');

const { publicUser, me } = require('./users.controller');

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
  const ok = row && (await bcrypt.compare(password, row.PasswordHash));
  if (!ok) throw new HttpError(401, 'Correo o contraseña incorrectos');
  const user = publicUser(row);
  res.json({ token: signToken(user), user });
});

module.exports = { register, login, me };
