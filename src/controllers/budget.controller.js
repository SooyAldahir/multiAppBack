/** Presupuesto por periodos, categorías editables y apartados de ahorro. */
const { HttpError, asyncHandler } = require('../utils/http');
const { validate } = require('../utils/validator');
const { parseId } = require('./crud.controller');
const schemas = require('../validators/schemas');
const budget = require('../services/budget.service');
const P = require('../services/budget-period.service');
const { chatJson } = require('../services/ai.service');

/** Fecha local que manda la app (?date=YYYY-MM-DD); si no viene, hoy en la zona del usuario. */
async function localDay(req, value) {
  if (value !== undefined) {
    if (!P.isValidDate(value)) throw new HttpError(400, 'date debe tener el formato YYYY-MM-DD');
    return value;
  }
  return P.localDate(Date.now(), await budget.userTimezone(req.user.id));
}

/* ---------------- Configuración ---------------- */

const getSettings = asyncHandler(async (req, res) => {
  res.json(await budget.getSettings(req.user.id));
});

// PUT /budget/settings { period, startDay?, alertsEnabled?, rolloverFundId?, date? }
const saveSettings = asyncHandler(async (req, res) => {
  const data = validate(schemas.budgetSettings, req.body);
  const current = await budget.getSettings(req.user.id);
  const next = { ...current, ...data };
  if (next.period === 'weekly' && next.startDay > 7) next.startDay = 1;
  if (next.period === 'biweekly') next.startDay = 1;
  if (next.rolloverFundId) await budget.getFund(req.user.id, next.rolloverFundId);
  await budget.saveSettings(req.user.id, next);
  // El periodo actual se ajusta de inmediato a la nueva forma (si sigue abierto).
  if (next.period !== current.period || next.startDay !== current.startDay) {
    await budget.reshapeCurrentPeriod(req.user.id, await localDay(req, req.body.date), next);
  }
  res.json(next);
});

/* ---------------- Categorías ---------------- */

const listCategories = asyncHandler(async (req, res) => {
  res.json(await budget.listCategories(req.user.id));
});

const createCategory = asyncHandler(async (req, res) => {
  const data = validate(schemas.budgetCategory, req.body);
  res.status(201).json(await budget.createCategory(req.user.id, data));
});

const updateCategory = asyncHandler(async (req, res) => {
  const data = validate(schemas.budgetCategory, req.body, { partial: true });
  res.json(await budget.updateCategory(req.user.id, parseId(req), data));
});

const deleteCategory = asyncHandler(async (req, res) => {
  await budget.deleteCategory(req.user.id, parseId(req));
  res.status(204).end();
});

/* ---------------- Periodos ---------------- */

// GET /budget/current?date=YYYY-MM-DD  (crea el periodo si aún no existe)
const current = asyncHandler(async (req, res) => {
  const day = await localDay(req, req.query.date);
  const period = await budget.ensurePeriod(req.user.id, day);
  res.json({ settings: await budget.getSettings(req.user.id), ...(await budget.periodView(req.user.id, period)) });
});

const listPeriods = asyncHandler(async (req, res) => {
  res.json(await budget.listPeriods(req.user.id));
});

const getPeriod = asyncHandler(async (req, res) => {
  const period = await budget.getPeriod(req.user.id, parseId(req));
  res.json({ settings: await budget.getSettings(req.user.id), ...(await budget.periodView(req.user.id, period)) });
});

// PUT /budget/periods/:id { income?, limits?: [{ categoryId, amount }] }
const updatePeriod = asyncHandler(async (req, res) => {
  const data = validate(schemas.budgetPeriodUpdate, req.body, { partial: true });
  let limits;
  if (data.limits) {
    limits = data.limits.map((l, i) => {
      const categoryId = Number(l?.categoryId);
      const amount = Number(l?.amount);
      if (!Number.isInteger(categoryId) || categoryId <= 0 || !Number.isFinite(amount) || amount < 0 || amount > 9999999999) {
        throw new HttpError(400, `El límite #${i + 1} no es válido`);
      }
      return { categoryId, amount };
    });
  }
  const period = await budget.updatePeriod(req.user.id, parseId(req), { income: data.income, limits });
  res.json({ settings: await budget.getSettings(req.user.id), ...(await budget.periodView(req.user.id, period)) });
});

// POST /budget/periods/:id/close { fundId? }
const closePeriod = asyncHandler(async (req, res) => {
  const { fundId } = validate(schemas.budgetClose, req.body || {});
  const id = parseId(req);
  const result = await budget.closePeriod(req.user.id, id, { fundId: fundId || null });
  const period = await budget.getPeriod(req.user.id, id);
  res.json({ ...result, ...(await budget.periodView(req.user.id, period)) });
});

// POST /budget/periods/:id/insights  -> resumen y consejos con IA
const insights = asyncHandler(async (req, res) => {
  const period = await budget.getPeriod(req.user.id, parseId(req));
  const view = await budget.periodView(req.user.id, period);
  const { funds } = await budget.listFunds(req.user.id);
  res.json(await generateInsights(view, funds));
});

const SYSTEM = `Eres un asesor de finanzas personales en México. Hablas en español, claro y amable, de tú.
Analizas el presupuesto de un periodo y das observaciones concretas con cantidades en pesos (MXN).
No das asesoría de inversión ni recomiendas productos financieros específicos.
Responde SOLO con JSON con esta forma:
{"resumen": "2-3 frases", "aciertos": ["..."], "alertas": ["..."], "consejos": ["..."], "ahorroSugerido": número}
Máximo 3 elementos por lista. ahorroSugerido = cantidad realista que podría apartar el siguiente periodo (0 si no aplica).`;

function summarizeForAi(view, funds) {
  const t = view.totals;
  return {
    periodo: `${view.period.startDate} a ${view.period.endDate}`,
    diasRestantes: view.period.daysLeft,
    ingreso: t.income,
    presupuestado: t.budgeted,
    gastado: t.spent,
    apartado: t.saved,
    disponible: t.available,
    categorias: view.categories
      .filter((c) => c.limit || c.spent)
      .map((c) => ({ nombre: c.name, limite: c.limit, gastado: c.spent, porcentaje: c.percent })),
    apartados: funds.map((f) => ({ nombre: f.name, saldo: f.balance, meta: f.goal, fechaMeta: f.goalDate })),
  };
}

function normalizeInsights(raw) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 3) : []);
  const n = Number(raw?.ahorroSugerido);
  return {
    summary: typeof raw?.resumen === 'string' ? raw.resumen.trim() : '',
    wins: list(raw?.aciertos),
    warnings: list(raw?.alertas),
    tips: list(raw?.consejos),
    suggestedSavings: Number.isFinite(n) && n > 0 ? Math.round(n) : 0,
  };
}

async function generateInsights(view, funds, opts = {}) {
  const data = summarizeForAi(view, funds);
  if (!data.ingreso && !data.gastado) {
    return {
      summary: 'Aún no hay suficiente información en este periodo. Registra tu ingreso y algunos gastos para recibir consejos.',
      wins: [],
      warnings: [],
      tips: [],
      suggestedSavings: 0,
    };
  }
  const raw = await chatJson(SYSTEM, `Datos del periodo:\n${JSON.stringify(data)}`, { temperature: 0.4, ...opts });
  return normalizeInsights(raw);
}

/* ---------------- Apartados ---------------- */

function checkAuto(data) {
  if (data.autoType === 'percent' && data.autoValue !== undefined && data.autoValue !== null && data.autoValue > 100) {
    throw new HttpError(400, 'El porcentaje automático no puede ser mayor a 100');
  }
  if (data.goalDate) data.goalDate = data.goalDate.toISOString().slice(0, 10);
  return data;
}

const listFunds = asyncHandler(async (req, res) => {
  res.json(await budget.listFunds(req.user.id, { includeArchived: req.query.archived === 'true' }));
});

const getFund = asyncHandler(async (req, res) => {
  const id = parseId(req);
  res.json({ ...(await budget.getFund(req.user.id, id)), movements: await budget.listMovements(req.user.id, id) });
});

const createFund = asyncHandler(async (req, res) => {
  const data = checkAuto(validate(schemas.savingsFund, req.body));
  res.status(201).json(await budget.createFund(req.user.id, data));
});

const updateFund = asyncHandler(async (req, res) => {
  const data = checkAuto(validate(schemas.savingsFund, req.body, { partial: true }));
  delete data.initialBalance;
  res.json(await budget.updateFund(req.user.id, parseId(req), data));
});

const deleteFund = asyncHandler(async (req, res) => {
  await budget.deleteFund(req.user.id, parseId(req));
  res.status(204).end();
});

// POST /funds/:id/movements { type: deposit|withdraw, amount, note?, movedAt? }
const addMovement = asyncHandler(async (req, res) => {
  const data = validate(schemas.fundMovement, req.body);
  const id = parseId(req);
  const movement = await budget.addMovement(req.user.id, id, data);
  res.status(201).json({ movement, fund: await budget.getFund(req.user.id, id) });
});

const deleteMovement = asyncHandler(async (req, res) => {
  await budget.deleteMovement(req.user.id, parseId(req));
  res.status(204).end();
});

module.exports = {
  getSettings,
  saveSettings,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  current,
  listPeriods,
  getPeriod,
  updatePeriod,
  closePeriod,
  insights,
  generateInsights,
  normalizeInsights,
  listFunds,
  getFund,
  createFund,
  updateFund,
  deleteFund,
  addMovement,
  deleteMovement,
};
