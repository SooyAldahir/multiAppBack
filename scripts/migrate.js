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

async function main() {
  const file = path.join(__dirname, '..', 'database', 'schema.sql');
  const list = batches(fs.readFileSync(file, 'utf8'));
  console.log(`▶ Conectando a ${env.db.server}/${env.db.database}…`);
  const pool = await getPool();
  console.log(`✔ Conectado. Ejecutando ${list.length} bloques de database/schema.sql`);
  for (const [i, batch] of list.entries()) {
    try {
      await pool.request().batch(batch);
    } catch (err) {
      console.error(`✖ Falló el bloque ${i + 1}:\n${batch.slice(0, 300)}…\n`);
      throw err;
    }
  }
  const tables = await pool.request().query("SELECT COUNT(*) AS N FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo')");
  console.log(`✔ Listo: la base tiene ${tables.recordset[0].N} tablas.`);
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

module.exports = { batches };
