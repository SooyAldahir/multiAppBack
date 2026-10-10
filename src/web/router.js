/**
 * Páginas públicas (fuera de /api) que piden App Store y Google Play:
 *   /privacidad        Aviso de privacidad integral
 *   /terminos          Términos y condiciones
 *   /eliminar-cuenta   Cómo eliminar la cuenta + formulario que funciona sin la app
 *   /soporte           Contacto y preguntas frecuentes
 * y los archivos para guardar contraseñas en el Llavero de iOS / Google:
 *   /.well-known/apple-app-site-association
 *   /.well-known/assetlinks.json
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { env } = require('../config/env');
const { query } = require('../config/db');
const { rateLimit } = require('../middleware/rate-limit');
const account = require('../services/account.service');
const content = require('./legal-content');

const router = express.Router();

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function page(req, title, body) {
  const l = env.legal;
  const base = baseUrl(req);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${content.esc(title)} · ${content.esc(l.appName)}</title>
<style>
  :root { --bg:#f6f7fb; --card:#fff; --text:#1d2433; --muted:#6b7280; --accent:#5b6cff; --danger:#d93f3f; --line:#e5e7eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12141a; --card:#1b1e27; --text:#e8eaf0; --muted:#9aa1ad; --line:#2a2e3a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header { background:var(--card); border-bottom:1px solid var(--line); }
  header .in, main { max-width:760px; margin:0 auto; padding:16px; }
  header .in { display:flex; flex-wrap:wrap; gap:6px 16px; align-items:center; }
  header strong { font-size:18px; margin-right:auto; }
  header a { color:var(--muted); text-decoration:none; font-size:14px; }
  header a:hover { color:var(--accent); }
  main { padding-bottom:48px; }
  h1 { font-size:28px; line-height:1.25; margin:24px 0 4px; }
  h2 { font-size:20px; margin:28px 0 8px; }
  h3 { font-size:17px; margin:20px 0 6px; }
  a { color:var(--accent); }
  .muted { color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; margin:16px 0; }
  label { display:block; margin:10px 0; font-weight:600; font-size:14px; }
  input[type=email], input[type=password] { display:block; width:100%; margin-top:4px; padding:12px; font-size:16px; border:1px solid var(--line); border-radius:10px; background:var(--bg); color:var(--text); }
  label.check { font-weight:400; display:flex; gap:8px; align-items:flex-start; }
  button { margin-top:8px; padding:12px 18px; font-size:16px; font-weight:700; border:0; border-radius:12px; cursor:pointer; }
  button.danger { background:var(--danger); color:#fff; }
  .notice { padding:12px 14px; border-radius:12px; margin:16px 0; font-weight:600; }
  .notice.ok { background:#e7f7ee; color:#11683a; }
  .notice.error { background:#fdeaea; color:#9b1c1c; }
  footer { max-width:760px; margin:0 auto; padding:0 16px 32px; color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<header><div class="in">
  <strong>${content.esc(l.appName)}</strong>
  <a href="${base}/privacidad">Privacidad</a>
  <a href="${base}/terminos">Términos</a>
  <a href="${base}/eliminar-cuenta">Eliminar cuenta</a>
  <a href="${base}/soporte">Soporte</a>
</div></header>
<main>${body}</main>
<footer>© ${new Date().getFullYear()} ${content.esc(l.ownerName)}</footer>
</body>
</html>`;
}

function send(res, html, status = 200) {
  res.status(status).type('html').set('Cache-Control', 'public, max-age=300').send(html);
}

router.get('/', (req, res) => res.redirect(302, '/soporte'));
router.get(['/privacidad', '/privacy'], (req, res) => send(res, page(req, 'Aviso de privacidad', content.privacy(env.legal, baseUrl(req)))));
router.get(['/terminos', '/terms'], (req, res) => send(res, page(req, 'Términos y condiciones', content.terms(env.legal, baseUrl(req)))));
router.get(['/soporte', '/support'], (req, res) => send(res, page(req, 'Soporte', content.support(env.legal, baseUrl(req)))));
router.get(['/eliminar-cuenta', '/delete-account'], (req, res) =>
  send(res, page(req, 'Eliminar cuenta', content.deletion(env.legal, baseUrl(req)))),
);

// Formulario web de eliminación (Google Play exige que se pueda sin reinstalar la app).
router.post(
  '/eliminar-cuenta',
  rateLimit({ max: 8, message: 'Demasiados intentos. Espera 15 minutos.' }),
  express.urlencoded({ extended: false, limit: '10kb' }),
  async (req, res, next) => {
    const render = (opts, status = 200) =>
      res.status(status).type('html').set('Cache-Control', 'no-store').send(page(req, 'Eliminar cuenta', content.deletion(env.legal, baseUrl(req), opts)));
    try {
      const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 255);
      const password = String(req.body?.password || '').trim().slice(0, 100);
      if (!email || !password || req.body?.confirm !== 'yes') {
        return render({ error: true, message: 'Escribe tu correo y contraseña, y marca la casilla de confirmación.' }, 400);
      }
      const r = await query('SELECT Id, PasswordHash FROM dbo.Users WHERE Email = @email', { email });
      const row = r.recordset[0];
      if (row && !row.PasswordHash) {
        return render({
          error: true,
          message: 'Esta cuenta se creó con Google o Apple. Elimínala desde la App o escríbenos desde ese correo (ver abajo).',
        }, 400);
      }
      const ok = row && (await bcrypt.compare(password, row.PasswordHash));
      if (!ok) return render({ error: true, message: 'Correo o contraseña incorrectos.' }, 401);
      await account.deleteAccount(row.Id);
      return render({ done: true, message: 'Listo: tu cuenta y todos tus datos fueron eliminados.' });
    } catch (err) {
      return next(err);
    }
  },
);

// Llavero de iOS: permite que la app guarde y autocomplete contraseñas de este dominio.
router.get('/.well-known/apple-app-site-association', (req, res) => {
  const appId = `${env.legal.appleTeamId}.${env.legal.bundleId}`;
  res.type('application/json').json({ webcredentials: { apps: [appId] } });
});

// Google Password Manager / Credential Manager (requiere la huella SHA-256 del certificado de la app).
router.get('/.well-known/assetlinks.json', (req, res) => {
  const fingerprints = env.legal.androidSha256;
  res.type('application/json').json(
    fingerprints.length
      ? [
          {
            relation: ['delegate_permission/common.get_login_creds', 'delegate_permission/common.handle_all_urls'],
            target: { namespace: 'android_app', package_name: env.legal.bundleId, sha256_cert_fingerprints: fingerprints },
          },
        ]
      : [],
  );
});

module.exports = router;
