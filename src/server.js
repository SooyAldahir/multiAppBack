const { env, assertEnv } = require('./config/env');
const { getPool, closePool } = require('./config/db');
const app = require('./app');
const dailySummary = require('./services/daily-summary.job');

async function start() {
  assertEnv();
  try {
    await getPool();
    console.log(`✔ Conectado a SQL Server (${env.db.server}/${env.db.database})`);
    if (env.autoMigrate) {
      const n = await require('../scripts/migrate').migrate({ log: () => {} });
      console.log(`✔ Tablas al día (${n})`);
    }
  } catch (err) {
    console.error('✖ No se pudo conectar a SQL Server:', err.message);
    console.error('  El servidor arrancará igual y reintentará en cada petición.');
  }

  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`✔ multiApp API escuchando en http://localhost:${env.port}/api`);
  });
  dailySummary.start();

  const shutdown = async () => {
    server.close();
    await closePool().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
