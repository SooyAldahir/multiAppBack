const sql = require('mssql');
const { env } = require('./env');

const config = {
  server: env.db.server,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  // Azure SQL serverless puede tardar hasta ~1 min en despertar: damos margen.
  connectionTimeout: 30000,
  requestTimeout: 30000,
  options: {
    encrypt: env.db.encrypt,
    trustServerCertificate: env.db.trustServerCertificate,
  },
  // min 0 + idleTimeout: no quedan conexiones abiertas, así Azure puede pausar la base
  // (una conexión abierta la mantiene despierta y gasta el plan gratuito).
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

/**
 * Errores temporales: la base de Azure está despertando o hubo un corte de red.
 * 40613 base no disponible (despertando) · 40197/40501 servicio ocupado · 49918-49920 sin recursos ·
 * 4060/18456 mientras se reanuda puede rechazar el login unos segundos.
 */
const TRANSIENT_NUMBERS = new Set([40613, 40197, 40501, 49918, 49919, 49920, 10928, 10929, 4060, 4221, 233, 64, 10053, 10054, 10060]);
const TRANSIENT_CODES = new Set(['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ECONNRESET', 'ENOTOPEN']);

function isTransient(err) {
  if (!err) return false;
  const number = err.number ?? err.originalError?.info?.number ?? err.originalError?.number;
  const code = err.code ?? err.originalError?.code;
  return TRANSIENT_NUMBERS.has(Number(number)) || TRANSIENT_CODES.has(code);
}

function neverRan(err) {
  const number = Number(err?.number ?? err?.originalError?.info?.number);
  const code = err?.code ?? err?.originalError?.code;
  return code === 'ECONNCLOSED' || code === 'ENOTOPEN' || number === 40613 || (code === 'ELOGIN' && isTransient(err));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Esperas entre reintentos al conectar (≈35 s en total, el tiempo típico de reanudar). */
const RETRY_DELAYS = [1500, 3000, 5000, 8000, 8000, 10000];

let poolPromise = null;

async function connectWithRetry() {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await new sql.ConnectionPool(config).connect();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === RETRY_DELAYS.length) break;
      if (attempt === 0) console.log('… la base de datos está despertando, reintentando');
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
  throw lastError;
}

function getPool() {
  if (!poolPromise) {
    poolPromise = connectWithRetry().catch((err) => {
      poolPromise = null; // permite reintentar en la siguiente petición
      throw err;
    });
  }
  return poolPromise;
}

async function resetPool() {
  const current = poolPromise;
  poolPromise = null;
  if (current) {
    try {
      (await current).close();
    } catch {
      // ya estaba cerrada
    }
  }
}

async function runQuery(text, params) {
  const pool = await getPool();
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) request.input(name, value[0], value[1]);
    else request.input(name, value);
  }
  return request.query(text);
}

/**
 * Ejecuta una consulta parametrizada.
 * params: { nombre: valor } o { nombre: [sql.Tipo, valor] } para fijar el tipo.
 * Si la conexión se cayó (p. ej. la base se pausó), se reconecta y se reintenta una vez.
 */
async function query(text, params = {}) {
  try {
    return await runQuery(text, params);
  } catch (err) {
    // Solo se reintenta si la consulta seguro no se ejecutó (conexión cerrada o base pausada);
    // así un INSERT nunca se duplica.
    if (!neverRan(err)) throw err;
    await resetPool();
    return runQuery(text, params);
  }
}

async function closePool() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

module.exports = { sql, query, getPool, closePool, isTransient };
