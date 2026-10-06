/** Controladores de Agenda, Notas, ToDo, Gastos y Lista de compras. */
const { sql, query } = require('../config/db');
const { createCrudController } = require('./crud.controller');
const { HttpError, asyncHandler, toCamel } = require('../utils/http');
const { validate } = require('../utils/validator');
const schemas = require('../validators/schemas');
const budget = require('../services/budget.service');

function parseDateParam(value, name) {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${name} no es una fecha válida`);
  return date;
}

/* ---------------- Agenda ---------------- */
const events = createCrudController({
  table: 'Events',
  schema: schemas.event,
  orderBy: 'StartAt ASC',
  types: { startAt: sql.DateTime2, endAt: sql.DateTime2 },
  // GET /events?from=ISO&to=ISO  -> eventos que se cruzan con ese rango
  listFilters: (q) => {
    const where = [];
    const params = {};
    const from = parseDateParam(q.from, 'from');
    const to = parseDateParam(q.to, 'to');
    if (from) {
      where.push('COALESCE(EndAt, StartAt) >= @from');
      params.from = [sql.DateTime2, from];
    }
    if (to) {
      where.push('StartAt < @to');
      params.to = [sql.DateTime2, to];
    }
    return { where, params };
  },
  beforeCreate: (data) => {
    if (data.endAt && data.endAt < data.startAt) {
      throw new HttpError(400, 'La hora de fin debe ser posterior al inicio');
    }
    return data;
  },
});

/* ---------------- Notas ---------------- */
const notes = createCrudController({
  table: 'Notes',
  schema: schemas.note,
  orderBy: 'IsPinned DESC, UpdatedAt DESC',
  // GET /notes?q=texto
  listFilters: (q) => {
    if (!q.q) return {};
    return {
      where: ['(Title LIKE @q OR Content LIKE @q)'],
      params: { q: `%${String(q.q).slice(0, 100)}%` },
    };
  },
});

/* ---------------- ToDo ---------------- */
function stampCompletion(data) {
  if (Object.prototype.hasOwnProperty.call(data, 'isCompleted')) {
    return { ...data, completedAt: data.isCompleted ? new Date() : null };
  }
  return data;
}

const todos = createCrudController({
  table: 'Todos',
  schema: schemas.todo,
  orderBy: 'IsCompleted ASC, CASE WHEN DueDate IS NULL THEN 1 ELSE 0 END, DueDate ASC, CreatedAt DESC',
  types: { dueDate: sql.DateTime2, completedAt: sql.DateTime2 },
  // GET /todos?status=pending|completed
  listFilters: (q) => {
    if (q.status === 'pending') return { where: ['IsCompleted = 0'] };
    if (q.status === 'completed') return { where: ['IsCompleted = 1'] };
    return {};
  },
  beforeCreate: stampCompletion,
  beforeUpdate: stampCompletion,
});

/* ---------------- Gastos ---------------- */
function expenseRange(q) {
  const where = [];
  const params = {};
  const from = parseDateParam(q.from, 'from');
  const to = parseDateParam(q.to, 'to');
  if (from) {
    where.push('SpentAt >= @from');
    params.from = [sql.DateTime2, from];
  }
  if (to) {
    where.push('SpentAt < @to');
    params.to = [sql.DateTime2, to];
  }
  return { where, params };
}

const expenses = createCrudController({
  table: 'Expenses',
  schema: schemas.expense,
  orderBy: 'SpentAt DESC',
  types: { amount: sql.Decimal(12, 2), spentAt: sql.DateTime2 },
  listFilters: expenseRange,
  // Si el gasto hace que su categoría pase del 80 % o del 100 % del presupuesto, se avisa en la respuesta.
  afterCreate: async (row, req) => {
    const alert = await budget.checkExpenseAlert(req.user.id, row);
    return alert ? { budgetAlert: alert } : {};
  },
});

// GET /expenses/summary?from=ISO&to=ISO -> total y total por categoría
expenses.summary = asyncHandler(async (req, res) => {
  const range = expenseRange(req.query);
  const where = ['UserId = @userId', ...range.where].join(' AND ');
  const result = await query(
    `SELECT Category, SUM(Amount) AS Total, COUNT(*) AS Count
       FROM dbo.Expenses WHERE ${where}
      GROUP BY Category ORDER BY Total DESC`,
    { userId: req.user.id, ...range.params },
  );
  const byCategory = result.recordset.map((r) => ({ ...toCamel(r), total: Number(r.Total) }));
  const total = byCategory.reduce((sum, r) => sum + r.total, 0);
  res.json({ total, byCategory });
});

/* ---------------- Lista de compras ---------------- */
const shopping = createCrudController({
  table: 'ShoppingItems',
  schema: schemas.shoppingItem,
  orderBy: 'IsChecked ASC, CreatedAt DESC',
});

// DELETE /shopping/checked -> limpia los artículos ya comprados
shopping.clearChecked = asyncHandler(async (req, res) => {
  const result = await query(
    'DELETE FROM dbo.ShoppingItems WHERE UserId = @userId AND IsChecked = 1',
    { userId: req.user.id },
  );
  res.json({ deleted: result.rowsAffected[0] || 0 });
});

// POST /shopping/bulk { items: [{ name, quantity? }] } -> agrega varios artículos (p. ej. ingredientes de una receta)
shopping.bulkCreate = asyncHandler(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Envía una lista "items" con al menos un artículo');
  }
  if (items.length > 50) throw new HttpError(400, 'Máximo 50 artículos por vez');

  const rows = items.map((item, i) => {
    try {
      return validate(schemas.shoppingItem, item);
    } catch (err) {
      err.message = `Artículo ${i + 1}: ${err.message}`;
      throw err;
    }
  });

  const params = { userId: req.user.id };
  const values = rows.map((row, i) => {
    params[`name${i}`] = row.name;
    params[`quantity${i}`] = row.quantity ?? null;
    return `(@userId, @name${i}, @quantity${i})`;
  });
  const result = await query(
    `INSERT INTO dbo.ShoppingItems (UserId, Name, Quantity) OUTPUT INSERTED.* VALUES ${values.join(', ')}`,
    params,
  );
  res.status(201).json(result.recordset.map(toCamel));
});

/* ---------------- Lugares guardados ---------------- */
const places = createCrudController({
  table: 'Places',
  schema: schemas.place,
  orderBy: "CASE Category WHEN 'home' THEN 0 WHEN 'work' THEN 1 ELSE 2 END, Name",
  types: { latitude: sql.Decimal(9, 6), longitude: sql.Decimal(9, 6) },
});

/* ---------------- Registro de comidas (calorías) ---------------- */
const foodLogs = createCrudController({
  table: 'FoodLogs',
  schema: schemas.foodLog,
  orderBy: 'EatenAt ASC',
  types: {
    eatenAt: sql.DateTime2,
    servings: sql.Decimal(5, 2),
    proteinG: sql.Decimal(6, 1),
    carbsG: sql.Decimal(6, 1),
    fatG: sql.Decimal(6, 1),
    calories: sql.Int,
    recipeId: sql.Int,
  },
  // GET /food-logs?from=ISO&to=ISO
  listFilters: (q) => {
    const where = [];
    const params = {};
    const from = parseDateParam(q.from, 'from');
    const to = parseDateParam(q.to, 'to');
    if (from) {
      where.push('EatenAt >= @from');
      params.from = [sql.DateTime2, from];
    }
    if (to) {
      where.push('EatenAt < @to');
      params.to = [sql.DateTime2, to];
    }
    return { where, params };
  },
  beforeCreate: (data) => {
    if (data.imageUrl && !/^https:\/\//.test(data.imageUrl)) throw new HttpError(400, 'imageUrl debe ser https');
    return { ...data, calories: Math.round(data.calories) };
  },
  beforeUpdate: (data) => {
    if (data.imageUrl && !/^https:\/\//.test(data.imageUrl)) throw new HttpError(400, 'imageUrl debe ser https');
    return data.calories === undefined ? data : { ...data, calories: Math.round(data.calories) };
  },
});

module.exports = { events, notes, todos, expenses, shopping, places, foodLogs };
