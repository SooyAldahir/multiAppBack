/**
 * Fábrica de controladores CRUD para tablas que pertenecen a un usuario (columna UserId).
 * Todas las consultas filtran por req.user.id, así un usuario nunca ve datos de otro.
 */
const db = require('../config/db');
const { HttpError, asyncHandler, toCamel, toPascal } = require('../utils/http');
const { validate } = require('../utils/validator');

function parseId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Id inválido');
  return id;
}

/** Convierte { campo: valor } en parámetros SQL, respetando tipos explícitos. */
function toParams(data, types = {}) {
  const params = {};
  for (const [key, value] of Object.entries(data)) {
    params[key] = types[key] ? [types[key], value] : value;
  }
  return params;
}

function createCrudController({
  table,
  schema,
  orderBy = 'CreatedAt DESC',
  types = {},
  listFilters,
  beforeCreate = (d) => d,
  beforeUpdate = (d) => d,
  // Datos extra para la respuesta después de crear (p. ej. alertas de presupuesto). No debe fallar el guardado.
  afterCreate,
}) {
  const list = asyncHandler(async (req, res) => {
    const where = ['UserId = @userId'];
    let params = { userId: req.user.id };
    if (listFilters) {
      const extra = listFilters(req.query) || {};
      where.push(...(extra.where || []));
      params = { ...params, ...(extra.params || {}) };
    }
    const result = await db.query(
      `SELECT * FROM dbo.${table} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`,
      params,
    );
    res.json(result.recordset.map(toCamel));
  });

  const getOne = asyncHandler(async (req, res) => {
    const id = parseId(req);
    const result = await db.query(
      `SELECT * FROM dbo.${table} WHERE Id = @id AND UserId = @userId`,
      { id, userId: req.user.id },
    );
    if (!result.recordset[0]) throw new HttpError(404, 'No encontrado');
    res.json(toCamel(result.recordset[0]));
  });

  const create = asyncHandler(async (req, res) => {
    const data = beforeCreate(validate(schema, req.body));
    const keys = Object.keys(data);
    const columns = ['UserId', ...keys.map(toPascal)].join(', ');
    const values = ['@userId', ...keys.map((k) => `@${k}`)].join(', ');
    const result = await db.query(
      `INSERT INTO dbo.${table} (${columns}) OUTPUT INSERTED.* VALUES (${values})`,
      { userId: req.user.id, ...toParams(data, types) },
    );
    const row = toCamel(result.recordset[0]);
    let extra = {};
    if (afterCreate) {
      try {
        extra = (await afterCreate(row, req)) || {};
      } catch (err) {
        console.warn(`afterCreate ${table}:`, err.message);
      }
    }
    res.status(201).json({ ...row, ...extra });
  });

  const update = asyncHandler(async (req, res) => {
    const id = parseId(req);
    const data = beforeUpdate(validate(schema, req.body, { partial: true }));
    const sets = Object.keys(data).map((k) => `${toPascal(k)} = @${k}`);
    sets.push('UpdatedAt = SYSUTCDATETIME()');
    const result = await db.query(
      `UPDATE dbo.${table} SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE Id = @id AND UserId = @userId`,
      { id, userId: req.user.id, ...toParams(data, types) },
    );
    if (!result.recordset[0]) throw new HttpError(404, 'No encontrado');
    res.json(toCamel(result.recordset[0]));
  });

  const remove = asyncHandler(async (req, res) => {
    const id = parseId(req);
    const result = await db.query(
      `DELETE FROM dbo.${table} OUTPUT DELETED.Id WHERE Id = @id AND UserId = @userId`,
      { id, userId: req.user.id },
    );
    if (!result.recordset[0]) throw new HttpError(404, 'No encontrado');
    res.status(204).end();
  });

  return { list, getOne, create, update, remove };
}

module.exports = { createCrudController, parseId };
