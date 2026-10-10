/**
 * Límite simple de intentos por IP (en memoria), para frenar ataques de fuerza bruta a
 * inicio de sesión, registro y eliminación de cuenta. Suficiente para una sola instancia en Render.
 */
const { HttpError } = require('../utils/http');

function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, message = 'Demasiados intentos. Espera unos minutos.' } = {}) {
  const hits = new Map(); // ip → { count, reset }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.reset <= now) hits.delete(ip);
  }, windowMs);
  timer.unref();

  return function limiter(req, res, next) {
    if (process.env.NODE_ENV === 'test') return next();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(ip, h);
    }
    h.count += 1;
    if (h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return next(new HttpError(429, message));
    }
    return next();
  };
}

module.exports = { rateLimit };
