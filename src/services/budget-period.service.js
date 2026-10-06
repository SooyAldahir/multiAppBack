/**
 * Cálculo de periodos de presupuesto con fechas locales ('YYYY-MM-DD') y zonas horarias, sin librerías.
 *
 *  - monthly:  del día `startDay` (1-28) de un mes al día anterior del mes siguiente.
 *  - biweekly: quincenas de calendario: 1-15 y 16-fin de mes.
 *  - weekly:   7 días empezando en `startDay` (1 = lunes … 7 = domingo).
 */

const PERIODS = ['monthly', 'biweekly', 'weekly'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function fmt(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function isValidDate(str) {
  return parseDate(str) !== null;
}

function addDays(str, n) {
  const dt = parseDate(str);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

function daysInMonth(y, m0) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Fecha de SQL Server (Date a medianoche UTC) o texto → 'YYYY-MM-DD'. */
function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Días entre dos fechas (b − a). */
function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

/** Periodo que contiene `dateStr` según la configuración. */
function periodFor(settings, dateStr) {
  const period = PERIODS.includes(settings?.period) ? settings.period : 'monthly';
  const dt = parseDate(dateStr);
  if (!dt) throw new Error(`Fecha inválida: ${dateStr}`);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth();
  const d = dt.getUTCDate();

  if (period === 'biweekly') {
    if (d <= 15) return { period, startDate: fmt(new Date(Date.UTC(y, m, 1))), endDate: fmt(new Date(Date.UTC(y, m, 15))) };
    return { period, startDate: fmt(new Date(Date.UTC(y, m, 16))), endDate: fmt(new Date(Date.UTC(y, m, daysInMonth(y, m)))) };
  }

  if (period === 'weekly') {
    const startDay = Math.min(Math.max(Number(settings?.startDay) || 1, 1), 7); // 1 = lunes
    const isoWeekday = ((dt.getUTCDay() + 6) % 7) + 1; // 1 = lunes … 7 = domingo
    const back = (isoWeekday - startDay + 7) % 7;
    const startDate = addDays(dateStr, -back);
    return { period, startDate, endDate: addDays(startDate, 6) };
  }

  const startDay = Math.min(Math.max(Number(settings?.startDay) || 1, 1), 28);
  const start = d >= startDay ? new Date(Date.UTC(y, m, startDay)) : new Date(Date.UTC(y, m - 1, startDay));
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, startDay));
  return { period, startDate: fmt(start), endDate: addDays(fmt(next), -1) };
}

/* ---------------- Zonas horarias ---------------- */

function zoneParts(timezone, instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return parts;
}

function safeZone(timezone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return timezone;
  } catch {
    return 'America/Mexico_City';
  }
}

/** Minutos que la zona está adelantada respecto a UTC en ese instante (México: −360). */
function zoneOffsetMinutes(timezone, instant) {
  const p = zoneParts(timezone, instant);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

/** Instante UTC en que empieza el día `dateStr` en la zona horaria. */
function zonedDayStart(dateStr, timezone) {
  const tz = safeZone(timezone);
  const guess = parseDate(dateStr).getTime();
  let instant = guess - zoneOffsetMinutes(tz, guess) * 60000;
  const second = guess - zoneOffsetMinutes(tz, instant) * 60000;
  if (second !== instant) instant = second;
  return new Date(instant);
}

/** Fecha local ('YYYY-MM-DD') de un instante en la zona horaria. */
function localDate(instant, timezone) {
  const p = zoneParts(safeZone(timezone), new Date(instant).getTime());
  return `${p.year}-${p.month}-${p.day}`;
}

/** Rango [from, to) en UTC que cubre un periodo de fechas locales. */
function periodRange(startDate, endDate, timezone) {
  return { from: zonedDayStart(startDate, timezone), to: zonedDayStart(addDays(endDate, 1), timezone) };
}

module.exports = {
  PERIODS,
  periodFor,
  addDays,
  diffDays,
  isValidDate,
  toDateString,
  zonedDayStart,
  localDate,
  periodRange,
};
