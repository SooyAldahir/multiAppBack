/**
 * Validador ligero sin dependencias.
 * Cada campo se describe con { type, required, nullable, min, max, values, email }.
 * Los campos que no estén en el esquema se descartan (lista blanca),
 * por eso es seguro usar sus nombres para construir columnas SQL.
 */
const { HttpError } = require('./http');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkField(name, rule, raw) {
  if (raw === null) {
    if (rule.nullable) return { value: null };
    return { error: `${name} no puede ser nulo` };
  }

  switch (rule.type) {
    case 'string': {
      if (typeof raw !== 'string') return { error: `${name} debe ser texto` };
      const value = raw.trim();
      if (rule.required && value.length === 0) return { error: `${name} es obligatorio` };
      if (rule.min !== undefined && value.length < rule.min) return { error: `${name} debe tener al menos ${rule.min} caracteres` };
      if (rule.max !== undefined && value.length > rule.max) return { error: `${name} admite máximo ${rule.max} caracteres` };
      if (rule.email && !EMAIL_RE.test(value)) return { error: `${name} no es un correo válido` };
      if (rule.values && !rule.values.includes(value)) return { error: `${name} debe ser uno de: ${rule.values.join(', ')}` };
      if (value.length === 0 && rule.nullable) return { value: null };
      return { value: rule.lowercase ? value.toLowerCase() : value };
    }
    case 'number': {
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) return { error: `${name} debe ser numérico` };
      if (rule.min !== undefined && value < rule.min) return { error: `${name} debe ser mayor o igual a ${rule.min}` };
      if (rule.max !== undefined && value > rule.max) return { error: `${name} debe ser menor o igual a ${rule.max}` };
      return { value };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 1) return { value: true };
      if (raw === 'false' || raw === 0) return { value: false };
      return { error: `${name} debe ser verdadero o falso` };
    }
    case 'date': {
      const value = new Date(raw);
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: `${name} debe ser una fecha ISO` };
      if (Number.isNaN(value.getTime())) return { error: `${name} no es una fecha válida` };
      return { value };
    }
    case 'array': {
      if (!Array.isArray(raw)) return { error: `${name} debe ser una lista` };
      if (rule.max !== undefined && raw.length > rule.max) return { error: `${name} admite máximo ${rule.max} elementos` };
      return { value: raw };
    }
    default:
      return { error: `Tipo desconocido para ${name}` };
  }
}

/**
 * Valida `body` contra `schema`.
 * Con { partial: true } (actualizaciones) los campos obligatorios pueden omitirse.
 */
function validate(schema, body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'El cuerpo de la petición debe ser un objeto JSON');
  }
  const data = {};
  const errors = {};

  for (const [name, rule] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(body, name) && body[name] !== undefined;
    if (!present) {
      if (rule.required && !partial) errors[name] = `${name} es obligatorio`;
      continue;
    }
    const result = checkField(name, rule, body[name]);
    if (result.error) errors[name] = result.error;
    else data[name] = result.value;
  }

  if (Object.keys(errors).length > 0) {
    throw new HttpError(400, 'Datos inválidos', errors);
  }
  if (partial && Object.keys(data).length === 0) {
    throw new HttpError(400, 'No se envió ningún campo para actualizar');
  }
  return data;
}

module.exports = { validate };
