/**
 * Verifica las notificaciones push (Firebase Cloud Messaging):
 *   npm run push:check                      → revisa la cuenta de servicio y que Google entregue un token
 *   npm run push:check -- tu@correo.com     → además manda un push de prueba a los teléfonos de ese usuario
 */
const { env } = require('../src/config/env');
const fcm = require('../src/services/fcm.service');

const EXPECTED_PROJECT = 'multiapp-db1c3';

async function main() {
  console.log('▶ Cuenta de servicio de Firebase…');
  if (!fcm.isConfigured()) {
    console.log('✖ No está configurada.');
    console.log('  1. Firebase Console → ⚙ Configuración del proyecto → Cuentas de servicio → "Generar nueva clave privada".');
    console.log('  2. Guarda el archivo como multiAppBack/firebase-service-account.json');
    console.log('  3. En .env: FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json');
    console.log(`  (ruta actual en .env: ${env.firebase.serviceAccountPath || '(vacía)'})`);
    process.exit(1);
  }
  const acc = fcm._account();
  console.log(`✔ Proyecto: ${acc.project_id}`);
  console.log(`✔ Cuenta:   ${acc.client_email}`);
  if (acc.project_id !== EXPECTED_PROJECT) {
    console.log(`⚠ La app usa el proyecto "${EXPECTED_PROJECT}". Si la clave es de otro proyecto, los push no llegarán.`);
  }

  console.log('\n▶ Pidiendo permiso a Google (OAuth)…');
  await fcm.getAccessToken();
  console.log('✔ Google aceptó la clave: el servidor ya puede enviar notificaciones.');

  const email = process.argv[2];
  if (!email) {
    console.log('\nPara probar un envío real: npm run push:check -- tu@correo.com');
    console.log('(primero abre la app en tu teléfono con esa cuenta para que se registre).');
    return;
  }

  console.log(`\n▶ Enviando push de prueba a ${email}…`);
  const { query, closePool } = require('../src/config/db');
  const { sendToUser } = require('../src/services/notifications.service');
  try {
    const u = await query('SELECT Id, Name FROM dbo.Users WHERE Email = @email', { email: email.toLowerCase() });
    const user = u.recordset[0];
    if (!user) {
      console.log('✖ No existe un usuario con ese correo.');
      process.exitCode = 1;
      return;
    }
    const r = await sendToUser(user.Id, {
      title: 'MultiApp',
      body: `¡Hola ${user.Name.split(' ')[0]}! Las notificaciones push ya funcionan 🎉`,
      data: { type: 'test' },
    });
    if (!r.devices) {
      console.log('✖ Ese usuario no tiene teléfonos registrados. Abre la app en el teléfono, inicia sesión y acepta las notificaciones.');
      process.exitCode = 1;
    } else {
      console.log(`✔ Enviado a ${r.sent} de ${r.devices} teléfono(s).${r.failed ? ` (${r.failed} fallaron; los tokens vencidos se quitaron)` : ''}`);
    }
  } finally {
    await closePool().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  if (/invalid_grant|JWT/i.test(err.message)) {
    console.error('  La clave no es válida o se revocó. Genera una nueva en Firebase y reemplaza el archivo.');
    console.error('  También revisa que la hora de la computadora sea correcta.');
  }
  process.exit(1);
});
