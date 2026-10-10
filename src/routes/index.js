const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rate-limit');
const auth = require('../controllers/auth.controller');
const dashboard = require('../controllers/dashboard.controller');
const recipes = require('../controllers/recipes.controller');
const geo = require('../controllers/geo.controller');
const health = require('../controllers/health.controller');
const users = require('../controllers/users.controller');
const { events, notes, todos, expenses, shopping, places, foodLogs } = require('../controllers/modules.controller');
const budget = require('../controllers/budget.controller');

/** Registra GET /, GET /:id, POST /, PATCH /:id, DELETE /:id para un controlador CRUD. */
function crudRoutes(controller, extra) {
  const r = Router();
  if (extra) extra(r);
  r.get('/', controller.list);
  r.post('/', controller.create);
  r.get('/:id', controller.getOne);
  r.patch('/:id', controller.update);
  r.delete('/:id', controller.remove);
  return r;
}

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Públicas
const authLimit = rateLimit({ max: 30, message: 'Demasiados intentos de inicio de sesión. Espera unos minutos.' });
router.post('/auth/register', authLimit, auth.register);
router.post('/auth/login', authLimit, auth.login);
router.post('/auth/google', authLimit, auth.google);
router.post('/auth/apple', authLimit, auth.apple);

// Protegidas
router.use(requireAuth);
router.get('/auth/me', auth.me);

// Perfil completo
router.get('/users/me', users.me);
router.patch('/users/me', users.updateMe);
router.delete('/users/me', rateLimit({ max: 10 }), users.deleteAccount);
router.post('/users/me/avatar', users.uploadAvatar);
router.delete('/users/me/avatar', users.deleteAvatar);
router.put('/users/me/password', users.changePassword);
router.put('/users/me/email', users.changeEmail);

// Notificaciones
router.get('/users/me/notifications', users.getNotificationPrefs);
router.put('/users/me/notifications', users.saveNotificationPrefs);
router.post('/devices', users.registerDevice);
router.delete('/devices/:token', users.unregisterDevice);
router.post('/notifications/test', users.testPush);
router.get('/dashboard', dashboard.today);
router.get('/activity', dashboard.activity);

router.use('/events', crudRoutes(events));
router.use('/notes', crudRoutes(notes));
router.use('/todos', crudRoutes(todos));
router.use('/expenses', crudRoutes(expenses, (r) => r.get('/summary', expenses.summary)));

// Presupuesto y apartados
router.get('/budget/settings', budget.getSettings);
router.put('/budget/settings', budget.saveSettings);
router.get('/budget/categories', budget.listCategories);
router.post('/budget/categories', budget.createCategory);
router.patch('/budget/categories/:id', budget.updateCategory);
router.delete('/budget/categories/:id', budget.deleteCategory);
router.get('/budget/current', budget.current);
router.get('/budget/periods', budget.listPeriods);
router.get('/budget/periods/:id', budget.getPeriod);
router.put('/budget/periods/:id', budget.updatePeriod);
router.post('/budget/periods/:id/close', budget.closePeriod);
router.post('/budget/periods/:id/insights', budget.insights);
router.get('/funds', budget.listFunds);
router.post('/funds', budget.createFund);
router.delete('/funds/movements/:id', budget.deleteMovement);
router.get('/funds/:id', budget.getFund);
router.patch('/funds/:id', budget.updateFund);
router.delete('/funds/:id', budget.deleteFund);
router.post('/funds/:id/movements', budget.addMovement);
router.use(
  '/shopping',
  crudRoutes(shopping, (r) => {
    r.post('/bulk', shopping.bulkCreate);
    r.post('/where-to-buy', geo.whereToBuy);
    r.delete('/checked', shopping.clearChecked);
  }),
);

router.use('/places', crudRoutes(places));

router.get('/geo/search', geo.search);
router.get('/geo/reverse', geo.reverse);
router.get('/geo/nearby', geo.nearby);
router.get('/geo/store-types', geo.storeTypes);

// Salud: perfil, rutinas y calorías
router.get('/health/profile', health.getProfile);
router.put('/health/profile', health.saveProfile);

const workoutsRouter = Router();
workoutsRouter.post('/generate', health.generate);
workoutsRouter.get('/', health.listSessions);
workoutsRouter.post('/', health.saveSession);
workoutsRouter.get('/:id', health.getSession);
workoutsRouter.delete('/:id', health.deleteSession);
router.use('/workouts', workoutsRouter);

router.post('/nutrition/estimate', health.estimateText);
router.post('/nutrition/estimate-photo', health.estimatePhoto);
router.get('/nutrition/summary', health.summary);
router.use('/food-logs', crudRoutes(foodLogs));

const recipesRouter = Router();
recipesRouter.post('/generate', recipes.generate);
recipesRouter.get('/', recipes.list);
recipesRouter.post('/', recipes.create);
recipesRouter.get('/:id', recipes.getOne);
recipesRouter.delete('/:id', recipes.remove);
router.use('/recipes', recipesRouter);

module.exports = router;
