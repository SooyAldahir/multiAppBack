/**
 * Presupuesto por periodos y apartados de ahorro (acceso a datos y cálculos).
 * Las categorías son las mismas de Gastos: Expenses.Category guarda el nombre.
 */
const { sql, query } = require('../config/db');
const { HttpError } = require('../utils/http');
const { getPrefs } = require('./notifications.service');
const P = require('./budget-period.service');

const DEFAULT_CATEGORIES = [
  ['Comida', 'restaurant', 'coral'],
  ['Súper', 'basket', 'green'],
  ['Transporte', 'car', 'blue'],
  ['Casa', 'home', 'amber'],
  ['Servicios', 'bolt', 'teal'],
  ['Salud', 'health', 'pink'],
  ['Medicamentos', 'medication', 'pink'],
  ['Entretenimiento', 'movie', 'violet'],
  ['Educación', 'school', 'blue'],
  ['Otros', 'other', 'ink'],
];
const FALLBACK_CATEGORY = 'Otros';
const DEFAULT_SETTINGS = { period: 'monthly', startDay: 1, alertsEnabled: true, rolloverFundId: null };

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

/* ---------------- Configuración ---------------- */

async function getSettings(userId) {
  const r = await query('SELECT * FROM dbo.BudgetSettings WHERE UserId = @userId', { userId });
  const row = r.recordset[0];
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    period: row.Period,
    startDay: Number(row.StartDay),
    alertsEnabled: Boolean(row.AlertsEnabled),
    rolloverFundId: row.RolloverFundId ?? null,
  };
}

async function saveSettings(userId, s) {
  await query(
    `MERGE dbo.BudgetSettings AS t
     USING (SELECT @userId AS UserId) AS src ON t.UserId = src.UserId
     WHEN MATCHED THEN UPDATE SET Period = @period, StartDay = @startDay, AlertsEnabled = @alerts,
       RolloverFundId = @rollover, UpdatedAt = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (UserId, Period, StartDay, AlertsEnabled, RolloverFundId)
       VALUES (@userId, @period, @startDay, @alerts, @rollover);`,
    {
      userId,
      period: s.period,
      startDay: [sql.TinyInt, s.startDay],
      alerts: [sql.Bit, s.alertsEnabled],
      rollover: [sql.Int, s.rolloverFundId ?? null],
    },
  );
}

async function userTimezone(userId) {
  try {
    return (await getPrefs(userId)).timezone || 'America/Mexico_City';
  } catch {
    return 'America/Mexico_City';
  }
}

/* ---------------- Categorías ---------------- */

const categoryFromRow = (r) => ({ id: r.Id, name: r.Name, icon: r.Icon, color: r.Color, sortOrder: r.SortOrder });

/** Lista las categorías; la primera vez crea las predeterminadas. */
async function listCategories(userId) {
  let r = await query('SELECT * FROM dbo.BudgetCategories WHERE UserId = @userId ORDER BY SortOrder, Name', { userId });
  if (r.recordset.length === 0) {
    const values = DEFAULT_CATEGORIES.map((_, i) => `(@userId, @n${i}, @i${i}, @c${i}, ${i})`).join(', ');
    const params = { userId };
    DEFAULT_CATEGORIES.forEach(([n, i, c], idx) => {
      params[`n${idx}`] = n;
      params[`i${idx}`] = i;
      params[`c${idx}`] = c;
    });
    await query(
      `INSERT INTO dbo.BudgetCategories (UserId, Name, Icon, Color, SortOrder)
       SELECT v.UserId, v.Name, v.Icon, v.Color, v.SortOrder FROM (VALUES ${values}) AS v(UserId, Name, Icon, Color, SortOrder)
       WHERE NOT EXISTS (SELECT 1 FROM dbo.BudgetCategories b WHERE b.UserId = v.UserId AND b.Name = v.Name)`,
      params,
    );
    r = await query('SELECT * FROM dbo.BudgetCategories WHERE UserId = @userId ORDER BY SortOrder, Name', { userId });
  }
  return r.recordset.map(categoryFromRow);
}

async function getCategory(userId, id) {
  const r = await query('SELECT * FROM dbo.BudgetCategories WHERE Id = @id AND UserId = @userId', { id, userId });
  if (!r.recordset[0]) throw new HttpError(404, 'Categoría no encontrada');
  return categoryFromRow(r.recordset[0]);
}

async function createCategory(userId, data) {
  await listCategories(userId); // asegura las predeterminadas
  const exists = await query('SELECT 1 FROM dbo.BudgetCategories WHERE UserId = @userId AND Name = @name', {
    userId,
    name: data.name,
  });
  if (exists.recordset.length) throw new HttpError(409, 'Ya tienes una categoría con ese nombre');
  const r = await query(
    `INSERT INTO dbo.BudgetCategories (UserId, Name, Icon, Color, SortOrder)
     OUTPUT INSERTED.*
     VALUES (@userId, @name, @icon, @color,
       (SELECT COALESCE(MAX(SortOrder), 0) + 1 FROM dbo.BudgetCategories WHERE UserId = @userId))`,
    { userId, name: data.name, icon: data.icon || 'other', color: data.color || 'ink' },
  );
  return categoryFromRow(r.recordset[0]);
}

/** Editar categoría. Si cambia el nombre, también se actualizan los gastos que la usan. */
async function updateCategory(userId, id, data) {
  const current = await getCategory(userId, id);
  if (data.name && data.name !== current.name) {
    if (current.name === FALLBACK_CATEGORY) throw new HttpError(400, `La categoría "${FALLBACK_CATEGORY}" no se puede renombrar`);
    const exists = await query('SELECT 1 FROM dbo.BudgetCategories WHERE UserId = @userId AND Name = @name AND Id <> @id', {
      userId,
      name: data.name,
      id,
    });
    if (exists.recordset.length) throw new HttpError(409, 'Ya tienes una categoría con ese nombre');
  }
  const next = { ...current, ...data };
  await query(
    `UPDATE dbo.BudgetCategories SET Name = @name, Icon = @icon, Color = @color, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id AND UserId = @userId;
     UPDATE dbo.Expenses SET Category = @name, UpdatedAt = SYSUTCDATETIME()
      WHERE UserId = @userId AND Category = @oldName AND @oldName <> @name;`,
    { id, userId, name: next.name, icon: next.icon, color: next.color, oldName: current.name },
  );
  return next;
}

/** Borrar categoría: sus gastos pasan a "Otros" y se quitan sus límites. */
async function deleteCategory(userId, id) {
  const current = await getCategory(userId, id);
  if (current.name === FALLBACK_CATEGORY) throw new HttpError(400, `La categoría "${FALLBACK_CATEGORY}" no se puede eliminar`);
  await query(
    `UPDATE dbo.Expenses SET Category = @fallback, UpdatedAt = SYSUTCDATETIME() WHERE UserId = @userId AND Category = @name;
     DELETE l FROM dbo.BudgetLimits l JOIN dbo.BudgetPeriods p ON p.Id = l.PeriodId
      WHERE p.UserId = @userId AND l.CategoryId = @id;
     DELETE FROM dbo.BudgetCategories WHERE Id = @id AND UserId = @userId;`,
    { userId, id, name: current.name, fallback: FALLBACK_CATEGORY },
  );
}

/* ---------------- Periodos ---------------- */

const periodFromRow = (r) => ({
  id: r.Id,
  startDate: P.toDateString(r.StartDate),
  endDate: P.toDateString(r.EndDate),
  period: r.Period,
  income: r.Income === null || r.Income === undefined ? null : money(r.Income),
  closedAt: r.ClosedAt ?? null,
});

async function getPeriod(userId, id) {
  const r = await query('SELECT * FROM dbo.BudgetPeriods WHERE Id = @id AND UserId = @userId', { id, userId });
  if (!r.recordset[0]) throw new HttpError(404, 'Periodo no encontrado');
  return periodFromRow(r.recordset[0]);
}

async function findPeriodForDate(userId, dateStr) {
  const r = await query(
    `SELECT TOP 1 * FROM dbo.BudgetPeriods
      WHERE UserId = @userId AND StartDate <= @d AND EndDate >= @d ORDER BY StartDate DESC`,
    { userId, d: [sql.Date, dateStr] },
  );
  return r.recordset[0] ? periodFromRow(r.recordset[0]) : null;
}

/**
 * Periodo que contiene la fecha; si no existe se crea con la configuración actual
 * y copia los límites del periodo anterior más reciente.
 */
async function ensurePeriod(userId, dateStr) {
  const found = await findPeriodForDate(userId, dateStr);
  if (found) return found;

  const settings = await getSettings(userId);
  let { startDate, endDate, period } = P.periodFor(settings, dateStr);

  // No encimar con periodos existentes (p. ej. después de cambiar de mensual a semanal).
  const before = await query(
    `SELECT TOP 1 * FROM dbo.BudgetPeriods WHERE UserId = @userId AND StartDate <= @d ORDER BY StartDate DESC`,
    { userId, d: [sql.Date, dateStr] },
  );
  const prev = before.recordset[0] ? periodFromRow(before.recordset[0]) : null;
  if (prev && prev.endDate >= startDate) startDate = P.addDays(prev.endDate, 1);
  const after = await query(
    `SELECT TOP 1 StartDate FROM dbo.BudgetPeriods WHERE UserId = @userId AND StartDate > @d ORDER BY StartDate ASC`,
    { userId, d: [sql.Date, dateStr] },
  );
  const nextStart = after.recordset[0] ? P.toDateString(after.recordset[0].StartDate) : null;
  if (nextStart && nextStart <= endDate) endDate = P.addDays(nextStart, -1);

  const ins = await query(
    `INSERT INTO dbo.BudgetPeriods (UserId, StartDate, EndDate, Period)
     OUTPUT INSERTED.* VALUES (@userId, @start, @end, @period)`,
    { userId, start: [sql.Date, startDate], end: [sql.Date, endDate], period },
  );
  const created = periodFromRow(ins.recordset[0]);

  // Se copia el plan (límites) del periodo anterior para no capturarlo cada vez.
  if (prev) {
    await query(
      `INSERT INTO dbo.BudgetLimits (PeriodId, CategoryId, Amount)
       SELECT @newId, l.CategoryId, l.Amount FROM dbo.BudgetLimits l
        JOIN dbo.BudgetCategories c ON c.Id = l.CategoryId AND c.UserId = @userId
       WHERE l.PeriodId = @prevId`,
      { newId: created.id, prevId: prev.id, userId },
    );
  }
  return created;
}

/** Al cambiar la configuración, el periodo actual (si sigue abierto) se ajusta a las nuevas fechas. */
async function reshapeCurrentPeriod(userId, dateStr, settings) {
  const current = await findPeriodForDate(userId, dateStr);
  if (!current || current.closedAt) return;
  let { startDate, endDate, period } = P.periodFor(settings, dateStr);
  const before = await query(
    `SELECT TOP 1 EndDate FROM dbo.BudgetPeriods WHERE UserId = @userId AND StartDate < @start AND Id <> @id ORDER BY StartDate DESC`,
    { userId, start: [sql.Date, current.startDate], id: current.id },
  );
  const prevEnd = before.recordset[0] ? P.toDateString(before.recordset[0].EndDate) : null;
  if (prevEnd && prevEnd >= startDate) startDate = P.addDays(prevEnd, 1);
  if (endDate < dateStr) endDate = dateStr;
  await query(
    `UPDATE dbo.BudgetPeriods SET StartDate = @start, EndDate = @end, Period = @period, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id AND UserId = @userId`,
    { id: current.id, userId, start: [sql.Date, startDate], end: [sql.Date, endDate], period },
  );
}

async function listPeriods(userId, limit = 24) {
  const r = await query(
    `SELECT TOP (@limit) p.*,
       (SELECT COALESCE(SUM(Amount), 0) FROM dbo.BudgetLimits l WHERE l.PeriodId = p.Id) AS Budgeted
     FROM dbo.BudgetPeriods p WHERE p.UserId = @userId ORDER BY p.StartDate DESC`,
    { userId, limit: [sql.Int, limit] },
  );
  return r.recordset.map((row) => ({ ...periodFromRow(row), budgeted: money(row.Budgeted) }));
}

/** Vista completa de un periodo: categorías con límite y gastado, totales y apartados del periodo. */
async function periodView(userId, period, { timezone } = {}) {
  const tz = timezone || (await userTimezone(userId));
  const { from, to } = P.periodRange(period.startDate, period.endDate, tz);
  const [categories, limits, spent, saved] = await Promise.all([
    listCategories(userId),
    query('SELECT CategoryId, Amount FROM dbo.BudgetLimits WHERE PeriodId = @id', { id: period.id }),
    query(
      `SELECT Category, SUM(Amount) AS Total, COUNT(*) AS Count FROM dbo.Expenses
        WHERE UserId = @userId AND SpentAt >= @from AND SpentAt < @to GROUP BY Category`,
      { userId, from: [sql.DateTime2, from], to: [sql.DateTime2, to] },
    ),
    query(
      `SELECT Source, SUM(Amount) AS Total FROM dbo.FundMovements
        WHERE UserId = @userId AND PeriodId = @id GROUP BY Source`,
      { userId, id: period.id },
    ),
  ]);

  const limitBy = new Map(limits.recordset.map((l) => [l.CategoryId, money(l.Amount)]));
  const names = new Set(categories.map((c) => c.name));
  const spentBy = new Map();
  for (const row of spent.recordset) {
    const name = names.has(row.Category) ? row.Category : FALLBACK_CATEGORY;
    const cur = spentBy.get(name) || { total: 0, count: 0 };
    spentBy.set(name, { total: money(cur.total + Number(row.Total)), count: cur.count + Number(row.Count) });
  }

  const rows = categories.map((c) => {
    const limit = limitBy.has(c.id) ? limitBy.get(c.id) : null;
    const s = spentBy.get(c.name) || { total: 0, count: 0 };
    return {
      ...c,
      limit,
      spent: s.total,
      count: s.count,
      remaining: limit === null ? null : money(limit - s.total),
      percent: limit ? Math.round((s.total / limit) * 1000) / 10 : null,
      status: limit === null ? 'none' : s.total > limit ? 'over' : s.total >= limit * 0.8 ? 'warning' : 'ok',
    };
  });

  const savedBy = Object.fromEntries(saved.recordset.map((r) => [r.Source, money(r.Total)]));
  const autoSaved = savedBy.auto || 0;
  const manualSaved = savedBy.manual || 0;
  const rolledOver = savedBy.rollover || 0;
  const budgeted = money(rows.reduce((s, r) => s + (r.limit || 0), 0));
  const totalSpent = money(rows.reduce((s, r) => s + r.spent, 0));
  const income = period.income;
  const savedTotal = money(autoSaved + manualSaved + rolledOver);

  const today = P.localDate(Date.now(), tz);
  const daysTotal = P.diffDays(period.startDate, period.endDate) + 1;
  const daysLeft = today > period.endDate ? 0 : today < period.startDate ? daysTotal : P.diffDays(today, period.endDate) + 1;

  return {
    period: { ...period, daysTotal, daysLeft, isCurrent: today >= period.startDate && today <= period.endDate },
    categories: rows,
    totals: {
      income,
      budgeted,
      spent: totalSpent,
      autoSaved,
      manualSaved,
      rolledOver,
      saved: savedTotal,
      // Lo que falta por asignar al planear: ingreso − límites − ahorro automático.
      unassigned: income === null ? null : money(income - budgeted - autoSaved),
      // Lo que queda realmente: ingreso − gastado − todo lo apartado este periodo.
      available: income === null ? null : money(income - totalSpent - savedTotal),
      // Para gastar al día en lo que resta del periodo.
      perDayLeft: income === null || daysLeft === 0 ? null : money(Math.max(0, income - totalSpent - savedTotal) / daysLeft),
    },
  };
}

/** Guarda ingreso y/o límites. Si cambia el ingreso, rehace el ahorro automático del periodo. */
async function updatePeriod(userId, periodId, { income, limits }) {
  const period = await getPeriod(userId, periodId);
  if (period.closedAt) throw new HttpError(409, 'Este periodo ya está cerrado');

  if (limits) {
    const cats = await listCategories(userId);
    const valid = new Set(cats.map((c) => c.id));
    for (const l of limits) {
      if (!valid.has(l.categoryId)) throw new HttpError(400, 'Hay una categoría que no existe');
    }
    await query('DELETE FROM dbo.BudgetLimits WHERE PeriodId = @id', { id: periodId });
    const positive = limits.filter((l) => l.amount > 0);
    if (positive.length) {
      const params = { id: periodId };
      const values = positive
        .map((l, i) => {
          params[`c${i}`] = [sql.Int, l.categoryId];
          params[`a${i}`] = [sql.Decimal(12, 2), money(l.amount)];
          return `(@id, @c${i}, @a${i})`;
        })
        .join(', ');
      await query(`INSERT INTO dbo.BudgetLimits (PeriodId, CategoryId, Amount) VALUES ${values}`, params);
    }
  }

  if (income !== undefined) {
    await query('UPDATE dbo.BudgetPeriods SET Income = @income, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND UserId = @userId', {
      id: periodId,
      userId,
      income: [sql.Decimal(12, 2), income === null ? null : money(income)],
    });
    await applyAutoSavings(userId, { ...period, income });
  }
  return getPeriod(userId, periodId);
}

/** Aportaciones automáticas a los apartados con regla (cantidad fija o % del ingreso). */
async function applyAutoSavings(userId, period) {
  await query("DELETE FROM dbo.FundMovements WHERE UserId = @userId AND PeriodId = @id AND Source = 'auto'", {
    userId,
    id: period.id,
  });
  if (!period.income) return [];
  const funds = await query(
    "SELECT Id, Name, AutoType, AutoValue FROM dbo.SavingsFunds WHERE UserId = @userId AND IsArchived = 0 AND AutoType <> 'none' AND AutoValue > 0",
    { userId },
  );
  const created = [];
  for (const f of funds.recordset) {
    const amount = f.AutoType === 'percent' ? money((period.income * Number(f.AutoValue)) / 100) : money(f.AutoValue);
    if (amount <= 0) continue;
    await query(
      `INSERT INTO dbo.FundMovements (FundId, UserId, Amount, Note, Source, PeriodId)
       VALUES (@fundId, @userId, @amount, @note, 'auto', @periodId)`,
      {
        fundId: f.Id,
        userId,
        amount: [sql.Decimal(12, 2), amount],
        note: f.AutoType === 'percent' ? `Automático: ${Number(f.AutoValue)} % del ingreso` : 'Automático del periodo',
        periodId: period.id,
      },
    );
    created.push({ fundId: f.Id, amount });
  }
  return created;
}

/** Cierra el periodo; lo que sobró puede pasar a un apartado. */
async function closePeriod(userId, periodId, { fundId } = {}) {
  const period = await getPeriod(userId, periodId);
  if (period.closedAt) throw new HttpError(409, 'Este periodo ya está cerrado');
  const view = await periodView(userId, period);
  const leftover = view.totals.available;
  let moved = 0;
  if (fundId && leftover && leftover > 0) {
    await getFund(userId, fundId);
    await query(
      `INSERT INTO dbo.FundMovements (FundId, UserId, Amount, Note, Source, PeriodId)
       VALUES (@fundId, @userId, @amount, @note, 'rollover', @periodId)`,
      {
        fundId,
        userId,
        amount: [sql.Decimal(12, 2), leftover],
        note: `Sobrante del periodo ${period.startDate} a ${period.endDate}`,
        periodId,
      },
    );
    moved = leftover;
  }
  await query('UPDATE dbo.BudgetPeriods SET ClosedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND UserId = @userId', {
    id: periodId,
    userId,
  });
  return { leftover: leftover ?? 0, moved };
}

/* ---------------- Alertas de gastos ---------------- */

/**
 * Revisa si un gasto nuevo hizo que su categoría cruzara el 80 % o el 100 % del límite.
 * Devuelve { category, level, spent, limit } o null.
 */
async function checkExpenseAlert(userId, expense) {
  const settings = await getSettings(userId);
  if (!settings.alertsEnabled) return null;
  const tz = await userTimezone(userId);
  const day = P.localDate(expense.spentAt || expense.SpentAt || Date.now(), tz);
  const period = await findPeriodForDate(userId, day);
  if (!period) return null;
  const categoryName = expense.category || expense.Category || FALLBACK_CATEGORY;
  const lim = await query(
    `SELECT l.Amount FROM dbo.BudgetLimits l JOIN dbo.BudgetCategories c ON c.Id = l.CategoryId
      WHERE l.PeriodId = @pid AND c.UserId = @userId AND c.Name = @name`,
    { pid: period.id, userId, name: categoryName },
  );
  const limit = lim.recordset[0] ? money(lim.recordset[0].Amount) : 0;
  if (!limit) return null;
  const { from, to } = P.periodRange(period.startDate, period.endDate, tz);
  const s = await query(
    `SELECT COALESCE(SUM(Amount), 0) AS Total FROM dbo.Expenses
      WHERE UserId = @userId AND Category = @name AND SpentAt >= @from AND SpentAt < @to`,
    { userId, name: categoryName, from: [sql.DateTime2, from], to: [sql.DateTime2, to] },
  );
  const after = money(s.recordset[0].Total);
  const before = money(after - Number(expense.amount ?? expense.Amount ?? 0));
  const level = crossedLevel(before, after, limit);
  return level ? { category: categoryName, level, spent: after, limit } : null;
}

function crossedLevel(before, after, limit) {
  if (before < limit && after >= limit) return 100;
  if (before < limit * 0.8 && after >= limit * 0.8) return 80;
  return null;
}

/* ---------------- Apartados ---------------- */

function fundFromRow(r) {
  const balance = money(r.Balance);
  const goal = r.Goal === null || r.Goal === undefined ? null : money(r.Goal);
  const goalDate = P.toDateString(r.GoalDate);
  let neededPerMonth = null;
  if (goal && goalDate && balance < goal) {
    const today = new Date().toISOString().slice(0, 10);
    const months = Math.max(1, Math.ceil(P.diffDays(today, goalDate) / 30.44));
    neededPerMonth = money((goal - balance) / months);
  }
  return {
    id: r.Id,
    name: r.Name,
    icon: r.Icon,
    color: r.Color,
    goal,
    goalDate,
    autoType: r.AutoType,
    autoValue: r.AutoValue === null || r.AutoValue === undefined ? null : Number(r.AutoValue),
    isArchived: Boolean(r.IsArchived),
    sortOrder: r.SortOrder,
    balance,
    progress: goal ? Math.min(100, Math.round((balance / goal) * 1000) / 10) : null,
    neededPerMonth,
    lastMovementAt: r.LastMovementAt ?? null,
  };
}

const FUND_SELECT = `SELECT f.*,
    (SELECT COALESCE(SUM(m.Amount), 0) FROM dbo.FundMovements m WHERE m.FundId = f.Id) AS Balance,
    (SELECT MAX(m.MovedAt) FROM dbo.FundMovements m WHERE m.FundId = f.Id) AS LastMovementAt
  FROM dbo.SavingsFunds f`;

async function listFunds(userId, { includeArchived = false } = {}) {
  const r = await query(
    `${FUND_SELECT} WHERE f.UserId = @userId ${includeArchived ? '' : 'AND f.IsArchived = 0'} ORDER BY f.SortOrder, f.CreatedAt`,
    { userId },
  );
  const funds = r.recordset.map(fundFromRow);
  return { funds, total: money(funds.reduce((s, f) => s + f.balance, 0)) };
}

async function getFund(userId, id) {
  const r = await query(`${FUND_SELECT} WHERE f.Id = @id AND f.UserId = @userId`, { id, userId });
  if (!r.recordset[0]) throw new HttpError(404, 'Apartado no encontrado');
  return fundFromRow(r.recordset[0]);
}

const FUND_COLUMNS = {
  name: ['Name', null],
  icon: ['Icon', null],
  color: ['Color', null],
  goal: ['Goal', () => sql.Decimal(12, 2)],
  goalDate: ['GoalDate', () => sql.Date],
  autoType: ['AutoType', null],
  autoValue: ['AutoValue', () => sql.Decimal(12, 2)],
  isArchived: ['IsArchived', () => sql.Bit],
  sortOrder: ['SortOrder', () => sql.Int],
};

function fundParams(data) {
  const params = {};
  for (const [k, v] of Object.entries(data)) {
    const [, type] = FUND_COLUMNS[k];
    params[k] = type ? [type(), v] : v;
  }
  return params;
}

async function createFund(userId, data) {
  const keys = Object.keys(data).filter((k) => FUND_COLUMNS[k]);
  const clean = Object.fromEntries(keys.map((k) => [k, data[k]]));
  const cols = ['UserId', ...keys.map((k) => FUND_COLUMNS[k][0]), 'SortOrder'].join(', ');
  const vals = ['@userId', ...keys.map((k) => `@${k}`), '(SELECT COALESCE(MAX(SortOrder), 0) + 1 FROM dbo.SavingsFunds WHERE UserId = @userId)'].join(', ');
  const r = await query(`INSERT INTO dbo.SavingsFunds (${cols}) OUTPUT INSERTED.Id VALUES (${vals})`, {
    userId,
    ...fundParams(clean),
  });
  const id = r.recordset[0].Id;
  if (data.initialBalance && data.initialBalance > 0) {
    await query(
      `INSERT INTO dbo.FundMovements (FundId, UserId, Amount, Note, Source) VALUES (@id, @userId, @amount, 'Saldo inicial', 'manual')`,
      { id, userId, amount: [sql.Decimal(12, 2), money(data.initialBalance)] },
    );
  }
  return getFund(userId, id);
}

async function updateFund(userId, id, data) {
  await getFund(userId, id);
  const keys = Object.keys(data).filter((k) => FUND_COLUMNS[k]);
  if (keys.length) {
    const sets = keys.map((k) => `${FUND_COLUMNS[k][0]} = @${k}`).join(', ');
    await query(`UPDATE dbo.SavingsFunds SET ${sets}, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id AND UserId = @userId`, {
      id,
      userId,
      ...fundParams(Object.fromEntries(keys.map((k) => [k, data[k]]))),
    });
  }
  return getFund(userId, id);
}

async function deleteFund(userId, id) {
  await getFund(userId, id);
  await query(
    `UPDATE dbo.BudgetSettings SET RolloverFundId = NULL WHERE UserId = @userId AND RolloverFundId = @id;
     DELETE FROM dbo.SavingsFunds WHERE Id = @id AND UserId = @userId;`,
    { id, userId },
  );
}

const movementFromRow = (r) => ({
  id: r.Id,
  fundId: r.FundId,
  amount: money(r.Amount),
  note: r.Note ?? null,
  source: r.Source,
  periodId: r.PeriodId ?? null,
  movedAt: r.MovedAt,
});

async function listMovements(userId, fundId, limit = 100) {
  await getFund(userId, fundId);
  const r = await query(
    'SELECT TOP (@limit) * FROM dbo.FundMovements WHERE FundId = @fundId AND UserId = @userId ORDER BY MovedAt DESC, Id DESC',
    { fundId, userId, limit: [sql.Int, limit] },
  );
  return r.recordset.map(movementFromRow);
}

/** Depósito (+) o retiro (−). El retiro no puede dejar el apartado en negativo. */
async function addMovement(userId, fundId, { type, amount, note, movedAt }) {
  const fund = await getFund(userId, fundId);
  const signed = type === 'withdraw' ? -money(amount) : money(amount);
  if (signed < 0 && fund.balance + signed < -0.001) {
    throw new HttpError(400, `No puedes retirar más de lo que hay en "${fund.name}"`);
  }
  const when = movedAt || new Date();
  const period = await findPeriodForDate(userId, P.localDate(when, await userTimezone(userId)));
  const r = await query(
    `INSERT INTO dbo.FundMovements (FundId, UserId, Amount, Note, Source, PeriodId, MovedAt)
     OUTPUT INSERTED.* VALUES (@fundId, @userId, @amount, @note, 'manual', @periodId, @movedAt)`,
    {
      fundId,
      userId,
      amount: [sql.Decimal(12, 2), signed],
      note: [sql.NVarChar(200), note ?? null],
      periodId: [sql.Int, period ? period.id : null],
      movedAt: [sql.DateTime2, when],
    },
  );
  return movementFromRow(r.recordset[0]);
}

async function deleteMovement(userId, movementId) {
  const r = await query('DELETE FROM dbo.FundMovements OUTPUT DELETED.Id WHERE Id = @id AND UserId = @userId', {
    id: movementId,
    userId,
  });
  if (!r.recordset[0]) throw new HttpError(404, 'Movimiento no encontrado');
}

module.exports = {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  FALLBACK_CATEGORY,
  getSettings,
  saveSettings,
  userTimezone,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getPeriod,
  findPeriodForDate,
  ensurePeriod,
  reshapeCurrentPeriod,
  listPeriods,
  periodView,
  updatePeriod,
  applyAutoSavings,
  closePeriod,
  checkExpenseAlert,
  crossedLevel,
  listFunds,
  getFund,
  createFund,
  updateFund,
  deleteFund,
  listMovements,
  addMovement,
  deleteMovement,
};
