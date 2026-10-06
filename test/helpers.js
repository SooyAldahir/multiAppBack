/** Utilidades de prueba: base de datos simulada y req/res falsos (no requiere SQL Server). */
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'x';
process.env.NODE_ENV = 'test';

const calls = [];
let nextResult = { recordset: [], rowsAffected: [0] };

const fakeDb = {
  query: async (text, params) => {
    calls.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    const r = typeof nextResult === 'function' ? nextResult(text, params) : nextResult;
    return r;
  },
  getPool: async () => ({}),
  closePool: async () => {},
};
// Imitación de los tipos de mssql (sql.DateTime2, sql.Decimal(12, 2), ...)
fakeDb.sql = new Proxy({}, {
  get: (_t, name) => {
    const fn = (...a) => ({ type: String(name), a });
    fn.type = String(name);
    return fn;
  },
});

const dbPath = path.join(__dirname, '..', 'src', 'config', 'db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

function setResult(r) { nextResult = r; }
function resetCalls() { calls.length = 0; }

function run(handler, { body, params = {}, query = {}, user = { id: 7 } } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      end() { resolve({ status: this.statusCode }); return this; },
    };
    handler({ body, params, query, user, headers: {} }, res, (err) => resolve({ error: err }));
  });
}

module.exports = { calls, setResult, resetCalls, run, fakeDb };
