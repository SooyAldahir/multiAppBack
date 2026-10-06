/**
 * Preferencias de notificaciones y envío de push a los dispositivos de un usuario.
 *
 * Los recordatorios (eventos, pendientes, entrenar, comidas) los programa el propio teléfono
 * con notificaciones locales a partir de estas preferencias. El servidor solo envía push para
 * cosas que el teléfono no sabe por sí mismo, como el resumen diario.
 */
const { EventEmitter } = require('node:events');
const { sql, query } = require('../config/db');
const fcm = require('./fcm.service');

/**
 * Avisa a quien le interese (el resumen diario) cuando cambian preferencias o se registra un teléfono,
 * para que no tenga que consultar la base cada minuto.
 */
const events = new EventEmitter();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_BEFORE = [0, 5, 10, 15, 30, 60, 120, 1440];

const DEFAULT_PREFS = {
  timezone: 'America/Mexico_City',
  events: { enabled: true, minutesBefore: 15 },
  todos: { enabled: true, time: '09:00' },
  workout: { enabled: false, time: '18:00', days: [1, 3, 5] },
  meals: { enabled: false, breakfast: '08:30', lunch: '14:30', dinner: '20:30' },
  dailySummary: { enabled: true, time: '07:30' },
};

function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Mezcla lo recibido con lo actual y descarta valores inválidos. */
function normalizePrefs(input = {}, current = DEFAULT_PREFS) {
  const base = { ...DEFAULT_PREFS, ...current };
  const out = JSON.parse(JSON.stringify(base));
  const src = input && typeof input === 'object' ? input : {};
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const time = (v, d) => (typeof v === 'string' && TIME_RE.test(v) ? v : d);

  if (typeof src.timezone === 'string' && validTimezone(src.timezone)) out.timezone = src.timezone;

  const e = src.events || {};
  out.events.enabled = bool(e.enabled, out.events.enabled);
  if (MINUTES_BEFORE.includes(Number(e.minutesBefore))) out.events.minutesBefore = Number(e.minutesBefore);

  const t = src.todos || {};
  out.todos.enabled = bool(t.enabled, out.todos.enabled);
  out.todos.time = time(t.time, out.todos.time);

  const w = src.workout || {};
  out.workout.enabled = bool(w.enabled, out.workout.enabled);
  out.workout.time = time(w.time, out.workout.time);
  if (Array.isArray(w.days)) {
    out.workout.days = [...new Set(w.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
  }

  const m = src.meals || {};
  out.meals.enabled = bool(m.enabled, out.meals.enabled);
  for (const k of ['breakfast', 'lunch', 'dinner']) out.meals[k] = time(m[k], out.meals[k]);

  const d = src.dailySummary || {};
  out.dailySummary.enabled = bool(d.enabled, out.dailySummary.enabled);
  out.dailySummary.time = time(d.time, out.dailySummary.time);

  if (typeof current.lastDailySummary === 'string') out.lastDailySummary = current.lastDailySummary;
  return out;
}

function parsePrefs(raw) {
  if (!raw) return normalizePrefs({}, DEFAULT_PREFS);
  try {
    return normalizePrefs({}, JSON.parse(raw));
  } catch {
    return normalizePrefs({}, DEFAULT_PREFS);
  }
}

/** Quita campos internos antes de enviarlos a la app. */
function publicPrefs(prefs) {
  const { lastDailySummary: _omit, ...rest } = prefs;
  return rest;
}

async function getPrefs(userId) {
  const r = await query('SELECT NotificationPrefs FROM dbo.Users WHERE Id = @userId', { userId });
  return parsePrefs(r.recordset[0]?.NotificationPrefs);
}

async function savePrefs(userId, prefs) {
  await query('UPDATE dbo.Users SET NotificationPrefs = @prefs, UpdatedAt = SYSUTCDATETIME() WHERE Id = @userId', {
    userId,
    prefs: [sql.NVarChar(sql.MAX), JSON.stringify(prefs)],
  });
  events.emit('prefs', userId, prefs);
}

/* ---------------- Dispositivos (tokens de FCM) ---------------- */

async function registerDevice(userId, token, platform) {
  // Si el token ya existía (p. ej. otra cuenta en el mismo teléfono), pasa a este usuario.
  await query(
    `MERGE dbo.DeviceTokens AS t
     USING (SELECT @token AS Token) AS s ON t.Token = s.Token
     WHEN MATCHED THEN UPDATE SET UserId = @userId, Platform = @platform, UpdatedAt = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (UserId, Token, Platform) VALUES (@userId, @token, @platform);`,
    { userId, token: [sql.NVarChar(400), token], platform },
  );
  events.emit('device', userId);
}

async function unregisterDevice(userId, token) {
  await query('DELETE FROM dbo.DeviceTokens WHERE UserId = @userId AND Token = @token', {
    userId,
    token: [sql.NVarChar(400), token],
  });
}

/** Envía un push a todos los teléfonos del usuario y borra los tokens que ya no sirven. */
async function sendToUser(userId, message, { fetchImpl } = {}) {
  const r = await query('SELECT Token FROM dbo.DeviceTokens WHERE UserId = @userId', { userId });
  let sent = 0;
  let failed = 0;
  for (const { Token } of r.recordset) {
    try {
      const result = await fcm.sendToToken(Token, message, fetchImpl ? { fetchImpl } : {});
      if (result.ok) {
        sent++;
      } else {
        failed++;
        if (result.invalidToken) await unregisterDevice(userId, Token);
        else console.warn('FCM:', result.error);
      }
    } catch (err) {
      failed++;
      console.warn('FCM:', err.message);
    }
  }
  return { devices: r.recordset.length, sent, failed };
}

module.exports = {
  events,
  DEFAULT_PREFS,
  normalizePrefs,
  parsePrefs,
  publicPrefs,
  getPrefs,
  savePrefs,
  registerDevice,
  unregisterDevice,
  sendToUser,
};
