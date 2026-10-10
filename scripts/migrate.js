/**
 * Crea o actualiza las tablas en la base configurada en .env (local o Azure SQL):
 *   npm run db:migrate
 *
 * Ejecuta database/schema.sql, que es seguro de correr varias veces (solo crea lo que falta).
 * Se saltan los bloques CREATE DATABASE / USE porque Azure SQL no los permite dentro de un script:
 * la base se elige con DB_NAME.
 */
const fs = require('node:fs');
const path = require('node:path');
const { env } = require('../src/config/env');
const { getPool, closePool } = require('../src/config/db');

function batches(sqlText) {
  return sqlText
    .split(/^\s*GO\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, '').trim().length > 0)
    .filter((b) => !/^\s*(\/\*[\s\S]*?\*\/\s*)*(IF\s+DB_ID\([^)]*\)\s+IS\s+NULL\s+)?CREATE\s+DATABASE\b/i.test(b))
    .filter((b) => !/^\s*(\/\*[\s\S]*?\*\/\s*)*USE\s+\w+\s*;?\s*$/i.test(b));
}

/** Ejecuta schema.sql (idempotente). Devuelve el número de tablas. */
async function migrate({ log = console.log } = {}) {
  const file = path.join(__dirname, '..', 'database', 'schema.sql');
  const list = batches(fs.readFileSync(file, 'utf8'));
  const pool = await getPool();
  log(`▶ Ejecutando ${list.length} bloques de database/schema.sql en ${env.db.server}/${env.db.database}`);
  for (const [i, batch] of list.entries()) {
    try {
      await pool.request().batch(batch);
    } catch (err) {
      err.message = `Falló el bloque ${i + 1} (${batch.slice(0, 120).replace(/\s+/g, ' ')}…): ${err.message}`;
      throw err;
    }
  }
  const tables = await pool.request().query("SELECT COUNT(*) AS N FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo')");
  return tables.recordset[0].N;
}

async function main() {
  console.log(`▶ Conectando a ${env.db.server}/${env.db.database}…`);
  const n = await migrate();
  console.log(`✔ Listo: la base tiene ${n} tablas.`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(`✖ ${err.message}`);
      if (/firewall|Client with IP address/i.test(err.message)) {
        console.error('  Azure bloqueó tu IP: en el portal, servidor SQL → Redes → "Agregar la IP de mi cliente".');
      }
      process.exitCode = 1;
    })
    .finally(() => closePool().catch(() => {}));
}

module.exports = { batches, migrate };
