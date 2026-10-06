/**
 * Resumen diario por notificación push: "Hoy tienes N eventos y M pendientes".
 *
 * Importante para Azure SQL serverless (plan gratuito): la base se pausa sola cuando nadie la usa y
 * solo cobra mientras está despierta. Por eso este trabajo NO consulta la base cada minuto:
 * guarda en memoria a qué hora quiere su resumen cada usuario y solo toca la base en ese momento.
 * La agenda en memoria se carga al arrancar y se actualiza cuando alguien cambia sus preferencias
 * o registra un teléfono.
 */
const { sql, query } = require('../config/db');
const fcm = require('./fcm.service');
const notifications = require('./notifications.service');

/** userId → { timezone, time, enabled, last } */
const schedule = new Map();
let loaded = false;
let loading = null;

/** Fecha (YYYY-MM-DD) y hora (HH:MM) actuales en la zona horaria indicada. */
function localNow(timezone, now = new Date()) {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'America/Mexico_City';
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function summaryText(name, events, todos) {
  const first = (name || '').trim().split(/\s+/)[0] || '';
  const ev = events === 0 ? 'sin eventos' : events === 1 ? '1 evento' : `${events} eventos`;
  const td = todos === 0 ? 'ningún pendiente' : todos === 1 ? '1 pendiente' : `${todos} pendientes`;
  return {
    title: `Buenos días${first ? `, ${first}` : ''}`,
    body: `Hoy tienes ${ev} y ${td}. ¡Que tengas un gran día!`,
  };
}

function remember(userId, prefs) {
  schedule.set(userId, {
    timezone: prefs.timezone,
    time: prefs.dailySummary.time,
    enabled: prefs.dailySummary.enabled,
    last: prefs.lastDailySummary || null,
  });
}

/** Carga la agenda de todos los usuarios con teléfono registrado (una sola consulta). */
async function loadSchedule() {
  if (loading) return loading;
  loading = (async () => {
    const r = await query(
      `SELECT u.Id, u.NotificationPrefs FROM dbo.Users u
        WHERE EXISTS (SELECT 1 FROM dbo.DeviceTokens d WHERE d.UserId = u.Id)`,
    );
    schedule.clear();
    for (const row of r.recordset) remember(row.Id, notifications.parsePrefs(row.NotificationPrefs));
    loaded = true;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Usuarios a los que les toca el resumen en este minuto (sin tocar la base). */
function dueUsers(now = new Date()) {
  const due = [];
  for (const [userId, s] of schedule) {
    if (!s.enabled) continue;
    const local = localNow(s.timezone, now);
    if (local.time === s.time && s.last !== local.date) due.push({ userId, local });
  }
  return due;
}

async function sendSummary(userId, local, now) {
  const u = await query('SELECT Name, NotificationPrefs FROM dbo.Users WHERE Id = @userId', { userId });
  const row = u.recordset[0];
  if (!row) {
    schedule.delete(userId);
    return false;
  }
  const prefs = notifications.parsePrefs(row.NotificationPrefs);
  // Medianoche local ≈ ahora − minutos transcurridos del día.
  const [h, m] = local.time.split(':').map(Number);
  const from = new Date(now.getTime() - (h * 60 + m) * 60000 - now.getSeconds() * 1000);
  const to = new Date(from.getTime() + 86400000);
  const counts = await query(
    `SELECT
       (SELECT COUNT(*) FROM dbo.Events WHERE UserId = @userId AND StartAt < @to AND COALESCE(EndAt, StartAt) >= @from) AS Events,
       (SELECT COUNT(*) FROM dbo.Todos WHERE UserId = @userId AND IsCompleted = 0 AND (DueDate IS NULL OR DueDate < @to)) AS Todos`,
    { userId, from: [sql.DateTime2, from], to: [sql.DateTime2, to] },
  );
  const { Events, Todos } = counts.recordset[0];
  const result = await notifications.sendToUser(userId, { ...summaryText(row.Name, Events, Todos), data: { type: 'daily_summary' } });
  // Se marca como enviado aunque no haya teléfonos, para no reintentar todo el día.
  await notifications.savePrefs(userId, { ...prefs, lastDailySummary: local.date });
  if (!result.devices) schedule.delete(userId);
  return result.sent > 0;
}

async function runOnce(now = new Date()) {
  if (!fcm.isConfigured()) return 0;
  if (!loaded) await loadSchedule();
  let notified = 0;
  for (const { userId, local } of dueUsers(now)) {
    // Se marca antes de enviar para no repetir si el envío tarda más de un minuto.
    const entry = schedule.get(userId);
    if (entry) entry.last = local.date;
    try {
      if (await sendSummary(userId, local, now)) notified++;
    } catch (err) {
      console.warn(`Resumen diario (usuario ${userId}):`, err.message);
    }
  }
  return notified;
}

function start() {
  if (!fcm.isConfigured()) {
    console.log('ℹ Notificaciones push desactivadas (configura FIREBASE_SERVICE_ACCOUNT para activarlas)');
    return null;
  }
  console.log('✔ Notificaciones push activas (resumen diario)');

  // Mantener la agenda al día sin consultar la base.
  notifications.events.on('prefs', (userId, prefs) => {
    if (schedule.has(userId) || loaded) remember(userId, prefs);
  });
  notifications.events.on('device', (userId) => {
    if (schedule.has(userId)) return;
    notifications
      .getPrefs(userId)
      .then((prefs) => remember(userId, prefs))
      .catch(() => {});
  });

  // Carga inicial (si la base no responde, se reintenta en el siguiente minuto).
  loadSchedule().catch((err) => console.warn('Resumen diario: no se pudo cargar la agenda todavía:', err.message));

  const timer = setInterval(() => {
    runOnce().catch((err) => console.warn('Resumen diario:', err.message));
  }, 60000);
  timer.unref();
  return timer;
}

module.exports = { start, runOnce, localNow, summaryText, dueUsers, remember, _schedule: schedule };
