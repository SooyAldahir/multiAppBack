const { HttpError } = require('../utils/http');
const { env } = require('../config/env');

function notFound(req, _res, next) {
  next(new HttpError(404, `Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON mal formado' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El contenido enviado es demasiado grande' });
  }
  // Violación de UNIQUE en SQL Server
  if (err.number === 2627 || err.number === 2601) {
    return res.status(409).json({ error: 'El registro ya existe' });
  }
  // Violación de CHECK constraint
  if (err.number === 547) {
    return res.status(400).json({ error: 'Los datos no cumplen las reglas de la base de datos' });
  }

  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);

  const body = { error: status >= 500 ? 'Error interno del servidor' : err.message };
  if (err.details) body.details = err.details;
  if (status >= 500 && env.nodeEnv !== 'production') body.debug = err.message;
  return res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
