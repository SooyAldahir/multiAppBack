/** Resumen para la pantalla de Inicio y feed de Actividad (cruza todos los módulos). */
const { sql, query } = require('../config/db');
const { HttpError, asyncHandler, toCamel } = require('../utils/http');

function dayRange(q) {
  // El cliente manda el inicio y fin de "hoy" en su zona horaria, convertidos a ISO.
  const from = q.from ? new Date(q.from) : new Date(new Date().setUTCHours(0, 0, 0, 0));
  const to = q.to ? new Date(q.to) : new Date(from.getTime() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpError(400, 'Rango de fechas inválido');
  }
  return { from, to };
}

// GET /api/dashboard?from=ISO&to=ISO
const today = asyncHandler(async (req, res) => {
  const { from, to } = dayRange(req.query);
  const params = { userId: req.user.id, from: [sql.DateTime2, from], to: [sql.DateTime2, to] };

  const [events, todos, counts] = await Promise.all([
    query(
      `SELECT * FROM dbo.Events
        WHERE UserId = @userId AND StartAt < @to AND COALESCE(EndAt, StartAt) >= @from
        ORDER BY StartAt ASC`,
      params,
    ),
    query(
      `SELECT TOP 5 * FROM dbo.Todos
        WHERE UserId = @userId AND IsCompleted = 0
        ORDER BY CASE WHEN DueDate IS NULL THEN 1 ELSE 0 END, DueDate ASC,
                 CASE Priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
      params,
    ),
    query(
      `SELECT
         (SELECT COUNT(*) FROM dbo.Todos WHERE UserId = @userId AND IsCompleted = 0) AS PendingTodos,
         (SELECT COUNT(*) FROM dbo.Todos WHERE UserId = @userId AND IsCompleted = 0 AND DueDate < @from) AS OverdueTodos,
         (SELECT COUNT(*) FROM dbo.Notes WHERE UserId = @userId) AS Notes,
         (SELECT COUNT(*) FROM dbo.ShoppingItems WHERE UserId = @userId AND IsChecked = 0) AS ShoppingPending`,
      params,
    ),
  ]);

  res.json({
    events: events.recordset.map(toCamel),
    todos: todos.recordset.map(toCamel),
    counts: toCamel(counts.recordset[0]),
  });
});

// GET /api/activity?limit=20&module=todo|event|note|expense|shopping
const activity = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const action = `CASE WHEN UpdatedAt > DATEADD(SECOND, 2, CreatedAt) THEN 'updated' ELSE 'created' END`;
  const result = await query(
    `SELECT TOP (@limit) * FROM (
        SELECT 'event' AS Module, Id, Title, ${action} AS Action, UpdatedAt FROM dbo.Events WHERE UserId = @userId
        UNION ALL
        SELECT 'note', Id, Title, ${action}, UpdatedAt FROM dbo.Notes WHERE UserId = @userId
        UNION ALL
        SELECT 'todo', Id, Title,
               CASE WHEN IsCompleted = 1 THEN 'completed' ELSE ${action} END, UpdatedAt
          FROM dbo.Todos WHERE UserId = @userId
        UNION ALL
        SELECT 'expense', Id, Description, ${action}, UpdatedAt FROM dbo.Expenses WHERE UserId = @userId
        UNION ALL
        SELECT 'shopping', Id, Name, ${action}, UpdatedAt FROM dbo.ShoppingItems WHERE UserId = @userId
     ) AS feed
     WHERE (@module IS NULL OR Module = @module)
     ORDER BY UpdatedAt DESC`,
    {
      userId: req.user.id,
      limit: [sql.Int, limit],
      module: [sql.NVarChar(20), req.query.module ? String(req.query.module) : null],
    },
  );
  res.json(result.recordset.map(toCamel));
});

module.exports = { today, activity };
