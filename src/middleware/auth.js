const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http');

/** Exige un header "Authorization: Bearer <token>" y deja el usuario en req.user. */
function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Necesitas iniciar sesión'));
  }
  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = { id: Number(payload.sub), email: payload.email, name: payload.name };
    return next();
  } catch {
    return next(new HttpError(401, 'Sesión inválida o expirada'));
  }
}

function signToken(user) {
  return jwt.sign({ sub: String(user.id), email: user.email, name: user.name }, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn,
  });
}

module.exports = { requireAuth, signToken };
