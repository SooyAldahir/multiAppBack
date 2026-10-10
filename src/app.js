const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { env } = require('./config/env');
const routes = require('./routes');
const web = require('./web/router');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();

app.disable('x-powered-by');
// Render (y otros hosts) ponen un proxy delante: así los registros muestran la IP real.
app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()),
  }),
);
// Las fotos (comida y perfil) llegan en base64: esas rutas aceptan cuerpos más grandes.
app.use(['/api/nutrition/estimate-photo', '/api/users/me/avatar'], express.json({ limit: '9mb' }));
app.use(express.json({ limit: '200kb' }));
if (env.nodeEnv !== 'test') app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use('/api', routes);
// Aviso de privacidad, términos, eliminación de cuenta y soporte (páginas públicas).
app.use(web);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
