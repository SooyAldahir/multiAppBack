class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Envuelve un handler async para que los errores lleguen al middleware de errores. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Convierte las columnas PascalCase de SQL Server a camelCase para el JSON. */
function toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.charAt(0).toLowerCase() + key.slice(1)] = value;
  }
  return out;
}

const toPascal = (key) => key.charAt(0).toUpperCase() + key.slice(1);

module.exports = { HttpError, asyncHandler, toCamel, toPascal };
