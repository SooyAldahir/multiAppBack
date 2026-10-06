/** Perfil de salud, rutinas de ejercicio y calorías. */
const { sql, query } = require('../config/db');
const { HttpError, asyncHandler, toCamel } = require('../utils/http');
const { validate } = require('../utils/validator');
const { parseId } = require('./crud.controller');
const schemas = require('../validators/schemas');
const { computeTargets, estimateBurn } = require('../services/health.service');
const { generateWorkout } = require('../services/fitness.service');
const nutrition = require('../services/nutrition.service');

const PROFILE_DEFAULTS = {
  activityLevel: 'light',
  goal: 'maintain',
  fitnessLevel: 'beginner',
  daysPerWeek: 3,
  minutesPerSession: 45,
  equipment: 'none',
  limitations: null,
};

async function loadProfile(userId) {
  const r = await query('SELECT * FROM dbo.HealthProfiles WHERE UserId = @userId', { userId });
  const row = r.recordset[0];
  if (!row) return null;
  const p = toCamel(row);
  return { ...p, heightCm: Number(p.heightCm), weightKg: Number(p.weightKg) };
}

function parseRange(q) {
  const from = q.from ? new Date(q.from) : new Date(new Date().setHours(0, 0, 0, 0));
  const to = q.to ? new Date(q.to) : new Date(from.getTime() + 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new HttpError(400, 'Rango de fechas inválido');
  return { from, to };
}

/* ---------------- Perfil de salud ---------------- */

// GET /api/health/profile
const getProfile = asyncHandler(async (req, res) => {
  const profile = await loadProfile(req.user.id);
  res.json({ profile, targets: computeTargets(profile) });
});

// PUT /api/health/profile
const saveProfile = asyncHandler(async (req, res) => {
  const data = { ...PROFILE_DEFAULTS, ...validate(schemas.healthProfile, req.body) };
  await query(
    `MERGE dbo.HealthProfiles AS t
     USING (SELECT @userId AS UserId) AS s ON t.UserId = s.UserId
     WHEN MATCHED THEN UPDATE SET
       Sex = @sex, BirthYear = @birthYear, HeightCm = @heightCm, WeightKg = @weightKg,
       ActivityLevel = @activityLevel, Goal = @goal, FitnessLevel = @fitnessLevel,
       DaysPerWeek = @daysPerWeek, MinutesPerSession = @minutesPerSession,
       Equipment = @equipment, Limitations = @limitations, UpdatedAt = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT
       (UserId, Sex, BirthYear, HeightCm, WeightKg, ActivityLevel, Goal, FitnessLevel,
        DaysPerWeek, MinutesPerSession, Equipment, Limitations)
       VALUES (@userId, @sex, @birthYear, @heightCm, @weightKg, @activityLevel, @goal, @fitnessLevel,
        @daysPerWeek, @minutesPerSession, @equipment, @limitations);`,
    {
      userId: req.user.id,
      sex: data.sex,
      birthYear: [sql.Int, Math.round(data.birthYear)],
      heightCm: [sql.Decimal(5, 1), data.heightCm],
      weightKg: [sql.Decimal(5, 1), data.weightKg],
      activityLevel: data.activityLevel,
      goal: data.goal,
      fitnessLevel: data.fitnessLevel,
      daysPerWeek: [sql.TinyInt, Math.round(data.daysPerWeek)],
      minutesPerSession: [sql.SmallInt, Math.round(data.minutesPerSession)],
      equipment: data.equipment,
      limitations: [sql.NVarChar(300), data.limitations ?? null],
    },
  );
  const profile = await loadProfile(req.user.id);
  res.json({ profile, targets: computeTargets(profile) });
});

/* ---------------- Rutinas ---------------- */

const sessionFromRow = (row) => {
  const s = toCamel(row);
  let exercises = [];
  try {
    exercises = JSON.parse(s.content || '[]');
  } catch {
    exercises = [];
  }
  delete s.content;
  return { ...s, exercises };
};

// POST /api/workouts/generate { focus?, minutes?, notes? }
const generate = asyncHandler(async (req, res) => {
  const body = validate(schemas.workoutGenerate, req.body || {});
  const profile = await loadProfile(req.user.id);
  const since = new Date(Date.now() - 7 * 86400000);
  const history = await query(
    `SELECT Title, Focus, PerformedAt FROM dbo.WorkoutSessions
      WHERE UserId = @userId AND PerformedAt >= @since ORDER BY PerformedAt DESC`,
    { userId: req.user.id, since: [sql.DateTime2, since] },
  );
  const plan = await generateWorkout({
    profile,
    history: history.recordset.map(toCamel),
    focus: body.focus || null,
    minutes: body.minutes || profile?.minutesPerSession || 45,
    notes: body.notes || null,
  });
  res.json(plan);
});

// GET /api/workouts?from=&to=
const listSessions = asyncHandler(async (req, res) => {
  const where = ['UserId = @userId'];
  const params = { userId: req.user.id };
  if (req.query.from) {
    const from = new Date(req.query.from);
    if (Number.isNaN(from.getTime())) throw new HttpError(400, 'from no es una fecha válida');
    where.push('PerformedAt >= @from');
    params.from = [sql.DateTime2, from];
  }
  if (req.query.to) {
    const to = new Date(req.query.to);
    if (Number.isNaN(to.getTime())) throw new HttpError(400, 'to no es una fecha válida');
    where.push('PerformedAt < @to');
    params.to = [sql.DateTime2, to];
  }
  const r = await query(
    `SELECT TOP 100 * FROM dbo.WorkoutSessions WHERE ${where.join(' AND ')} ORDER BY PerformedAt DESC`,
    params,
  );
  res.json(r.recordset.map(sessionFromRow));
});

// POST /api/workouts  (guarda un entrenamiento terminado y lo agrega a la Agenda)
const saveSession = asyncHandler(async (req, res) => {
  const data = validate(schemas.workoutSession, req.body);
  const performedAt = data.performedAt || new Date();
  let calories = data.caloriesBurned;
  if (calories === undefined || calories === null) {
    const profile = await loadProfile(req.user.id);
    calories = estimateBurn(data.durationMinutes, profile?.weightKg);
  }

  const r = await query(
    `INSERT INTO dbo.WorkoutSessions (UserId, Title, Focus, PerformedAt, DurationMinutes, CaloriesBurned, Content)
     OUTPUT INSERTED.* VALUES (@userId, @title, @focus, @performedAt, @duration, @calories, @content)`,
    {
      userId: req.user.id,
      title: data.title,
      focus: [sql.NVarChar(150), data.focus ?? null],
      performedAt: [sql.DateTime2, performedAt],
      duration: [sql.Int, Math.round(data.durationMinutes)],
      calories: [sql.Int, Math.round(calories)],
      content: [sql.NVarChar(sql.MAX), JSON.stringify(data.exercises || [])],
    },
  );

  // También queda en la Agenda (si falla, el entrenamiento ya está guardado).
  try {
    const start = new Date(performedAt.getTime() - data.durationMinutes * 60000);
    await query(
      `INSERT INTO dbo.Events (UserId, Title, Description, StartAt, EndAt, Color)
       VALUES (@userId, @title, @description, @start, @end, 'coral')`,
      {
        userId: req.user.id,
        title: `Entrenamiento: ${data.title}`.slice(0, 150),
        description: `${Math.round(data.durationMinutes)} min · ${Math.round(calories)} kcal aprox.`,
        start: [sql.DateTime2, start],
        end: [sql.DateTime2, performedAt],
      },
    );
  } catch (err) {
    console.warn('No se pudo agregar el entrenamiento a la agenda:', err.message);
  }

  res.status(201).json(sessionFromRow(r.recordset[0]));
});

const getSession = asyncHandler(async (req, res) => {
  const r = await query('SELECT * FROM dbo.WorkoutSessions WHERE Id = @id AND UserId = @userId', {
    id: parseId(req),
    userId: req.user.id,
  });
  if (!r.recordset[0]) throw new HttpError(404, 'Entrenamiento no encontrado');
  res.json(sessionFromRow(r.recordset[0]));
});

const deleteSession = asyncHandler(async (req, res) => {
  const r = await query('DELETE FROM dbo.WorkoutSessions OUTPUT DELETED.Id WHERE Id = @id AND UserId = @userId', {
    id: parseId(req),
    userId: req.user.id,
  });
  if (!r.recordset[0]) throw new HttpError(404, 'Entrenamiento no encontrado');
  res.status(204).end();
});

/* ---------------- Calorías ---------------- */

// POST /api/nutrition/estimate { text }
const estimateText = asyncHandler(async (req, res) => {
  const { text } = validate(schemas.nutritionText, req.body);
  res.json(await nutrition.estimateFromText(text));
});

// POST /api/nutrition/estimate-photo { image: base64 | dataURI, note? }
const estimatePhoto = asyncHandler(async (req, res) => {
  const { image, note } = validate(schemas.nutritionPhoto, req.body);
  const dataUri = image.startsWith('data:image/') ? image : `data:image/jpeg;base64,${image}`;
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  if (base64.length * 0.75 > 6 * 1024 * 1024) throw new HttpError(413, 'La foto es muy pesada (máx. 6 MB)');

  // La foto solo se analiza; no se guarda en ningún lado.
  const estimate = await nutrition.estimateFromPhoto(dataUri, note);
  res.json({ ...estimate, imageUrl: null });
});

// GET /api/nutrition/summary?from=&to=
const summary = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const params = { userId: req.user.id, from: [sql.DateTime2, from], to: [sql.DateTime2, to] };
  const [food, burned, profile] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(Calories), 0) AS Calories, COALESCE(SUM(ProteinG), 0) AS Protein,
              COALESCE(SUM(CarbsG), 0) AS Carbs, COALESCE(SUM(FatG), 0) AS Fat, COUNT(*) AS Entries
         FROM dbo.FoodLogs WHERE UserId = @userId AND EatenAt >= @from AND EatenAt < @to`,
      params,
    ),
    query(
      `SELECT COALESCE(SUM(CaloriesBurned), 0) AS Burned, COUNT(*) AS Sessions
         FROM dbo.WorkoutSessions WHERE UserId = @userId AND PerformedAt >= @from AND PerformedAt < @to`,
      params,
    ),
    loadProfile(req.user.id),
  ]);
  const f = food.recordset[0];
  const b = burned.recordset[0];
  res.json({
    consumed: {
      calories: Number(f.Calories),
      protein: Number(f.Protein),
      carbs: Number(f.Carbs),
      fat: Number(f.Fat),
      entries: Number(f.Entries),
    },
    burned: { calories: Number(b.Burned), sessions: Number(b.Sessions) },
    targets: computeTargets(profile),
  });
});

module.exports = {
  getProfile,
  saveProfile,
  generate,
  listSessions,
  saveSession,
  getSession,
  deleteSession,
  estimateText,
  estimatePhoto,
  summary,
};
