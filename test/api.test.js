const test = require('node:test');
const assert = require('node:assert/strict');
const { calls, setResult, resetCalls, run } = require('./helpers');
const { validate } = require('../src/utils/validator');
const schemas = require('../src/validators/schemas');
const { todos, events, notes, shopping, expenses } = require('../src/controllers/modules.controller');
const { normalizeRecipe, extractJson } = require('../src/services/ai.service');
const { requireAuth, signToken } = require('../src/middleware/auth');

test('validator: descarta campos desconocidos y recorta texto', () => {
  const data = validate(schemas.note, { title: '  Hola ', hacker: 'DROP TABLE', isPinned: true });
  assert.deepEqual(data, { title: 'Hola', isPinned: true });
});

test('validator: reporta campos obligatorios y tipos', () => {
  assert.throws(() => validate(schemas.todo, { priority: 'urgente' }), (err) => {
    assert.equal(err.status, 400);
    assert.ok(err.details.title);
    assert.ok(err.details.priority);
    return true;
  });
});

test('validator: partial exige al menos un campo', () => {
  assert.throws(() => validate(schemas.todo, {}, { partial: true }), /ningún campo/);
});

test('crud create: inserta con UserId del token y columnas en PascalCase', async () => {
  resetCalls();
  setResult({ recordset: [{ Id: 1, UserId: 7, Title: 'Comprar pan', IsCompleted: false }] });
  const r = await run(todos.create, { body: { title: 'Comprar pan', priority: 'high', userId: 99 } });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { id: 1, userId: 7, title: 'Comprar pan', isCompleted: false });
  assert.match(calls[0].text, /INSERT INTO dbo\.Todos \(UserId, Title, Priority\) OUTPUT INSERTED\.\* VALUES \(@userId, @title, @priority\)/);
  assert.equal(calls[0].params.userId, 7); // ignora el userId enviado por el cliente
});

test('crud update: marcar completada guarda CompletedAt y filtra por usuario', async () => {
  resetCalls();
  setResult({ recordset: [{ Id: 3, IsCompleted: true }] });
  const r = await run(todos.update, { params: { id: '3' }, body: { isCompleted: true } });
  assert.equal(r.status, 200);
  assert.match(calls[0].text, /SET IsCompleted = @isCompleted, CompletedAt = @completedAt, UpdatedAt = SYSUTCDATETIME\(\)/);
  assert.match(calls[0].text, /WHERE Id = @id AND UserId = @userId/);
  assert.ok(calls[0].params.completedAt[1] instanceof Date);
});

test('crud get: 404 si no existe y 400 si el id es inválido', async () => {
  setResult({ recordset: [] });
  const r1 = await run(notes.getOne, { params: { id: '5' } });
  assert.equal(r1.error.status, 404);
  const r2 = await run(notes.getOne, { params: { id: 'abc' } });
  assert.equal(r2.error.status, 400);
});

test('events list: aplica rango de fechas', async () => {
  resetCalls();
  setResult({ recordset: [] });
  await run(events.list, { query: { from: '2026-10-04T06:00:00.000Z', to: '2026-10-05T06:00:00.000Z' } });
  assert.match(calls[0].text, /UserId = @userId AND COALESCE\(EndAt, StartAt\) >= @from AND StartAt < @to ORDER BY StartAt ASC/);
});

test('events create: rechaza fin antes del inicio', async () => {
  const r = await run(events.create, { body: { title: 'x', startAt: '2026-10-04T10:00:00Z', endAt: '2026-10-04T09:00:00Z' } });
  assert.equal(r.error.status, 400);
});

test('auth: token válido llena req.user, inválido devuelve 401', () => {
  const token = signToken({ id: 12, email: 'a@b.com', name: 'Ana' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  requireAuth(req, {}, (err) => assert.equal(err, undefined));
  assert.equal(req.user.id, 12);
  requireAuth({ headers: { authorization: 'Bearer basura' } }, {}, (err) => assert.equal(err.status, 401));
  requireAuth({ headers: {} }, {}, (err) => assert.equal(err.status, 401));
});

test('ia: normaliza recetas incompletas', () => {
  const r = normalizeRecipe({ title: 'Tacos', ingredients: ['tortilla', { name: 'carne', quantity: '200 g' }], steps: [1, 'b'] });
  assert.equal(r.servings, 2);
  assert.deepEqual(r.ingredients[0], { name: 'tortilla', quantity: '' });
  assert.deepEqual(r.steps, ['1', 'b']);
});

test('ia: extrae JSON aunque venga dentro de un bloque de código', () => {
  const text = 'Aquí tienes:\n```json\n{"title":"Tacos","steps":["a"]}\n```';
  assert.deepEqual(extractJson(text), { title: 'Tacos', steps: ['a'] });
});

test('ia: reintenta sin response_format y traduce errores del proveedor', async () => {
  const { env } = require('../src/config/env');
  const { generateRecipe } = require('../src/services/ai.service');
  env.ai.apiKey = 'clave-falsa';
  const bodies = [];
  const ok = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const fail = (status, text) => ({ ok: false, status, text: async () => text });

  let calls = 0;
  const recipe = await generateRecipe({ prompt: 'tacos' }, {
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      calls += 1;
      return calls === 1 ? fail(400, 'response_format not supported') : ok('{"title":"Tacos"}');
    },
  });
  assert.equal(recipe.title, 'Tacos');
  assert.ok(bodies[0].response_format);
  assert.equal(bodies[1].response_format, undefined);

  await assert.rejects(generateRecipe({ prompt: 'tacos' }, { fetchImpl: async () => fail(429, 'quota') }), (e) => e.status === 429);
  await assert.rejects(generateRecipe({ prompt: 'tacos' }, { fetchImpl: async () => fail(404, 'model') }), /no existe/);
});

test('compras en lote: inserta varios artículos en una sola consulta', async () => {
  resetCalls();
  setResult({ recordset: [{ Id: 1, Name: 'Tortillas' }, { Id: 2, Name: 'Queso' }] });
  const r = await run(shopping.bulkCreate, {
    body: { items: [{ name: 'Tortillas', quantity: '1 kg' }, { name: ' Queso ' }] },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.length, 2);
  assert.match(calls[0].text, /VALUES \(@userId, @name0, @quantity0\), \(@userId, @name1, @quantity1\)/);
  assert.equal(calls[0].params.name1, 'Queso');
  assert.equal(calls[0].params.quantity1, null);
});

test('compras en lote: valida la lista', async () => {
  const empty = await run(shopping.bulkCreate, { body: { items: [] } });
  assert.equal(empty.error.status, 400);
  const bad = await run(shopping.bulkCreate, { body: { items: [{ name: 'ok' }, { quantity: '2' }] } });
  assert.match(bad.error.message, /Artículo 2/);
});

test('gastos: el resumen suma por categoría dentro del rango', async () => {
  resetCalls();
  setResult({ recordset: [{ Category: 'Comida', Total: 150.5, Count: 3 }, { Category: 'Transporte', Total: 49.5, Count: 2 }] });
  const r = await run(expenses.summary, { query: { from: '2026-10-01T06:00:00Z', to: '2026-11-01T06:00:00Z' } });
  assert.equal(r.body.total, 200);
  assert.match(calls[0].text, /SpentAt >= @from AND SpentAt < @to GROUP BY Category/);
});

/* ---------------- Lugares y mapas ---------------- */
const geo = require('../src/services/geo.service');
const { classifyItems, classifyByKeywords } = require('../src/services/where-to-buy.service');

test('mapas: distancia entre dos puntos', () => {
  // Zócalo CDMX → Bellas Artes ≈ 950 m
  const d = geo.distanceMeters(19.4326, -99.1332, 19.4352, -99.1412);
  assert.ok(d > 800 && d < 1000, `distancia ${d}`);
});

test('mapas: consulta y lectura de Overpass', () => {
  const q = geo.buildOverpassQuery(['pharmacy'], 19.43, -99.13, 2000);
  assert.match(q, /nwr\["amenity"="pharmacy"\]\(around:2000,19.43,-99.13\);/);
  assert.match(q, /nwr\["shop"="chemist"\]/);

  const data = {
    elements: [
      { type: 'node', id: 1, lat: 19.44, lon: -99.13, tags: { amenity: 'pharmacy', name: 'Farmacia Lejos' } },
      { type: 'way', id: 2, center: { lat: 19.431, lon: -99.13 }, tags: { shop: 'chemist', brand: 'Similares' } },
      { type: 'node', id: 3, lat: 19.43, lon: -99.13, tags: { shop: 'bakery', name: 'No pedida' } },
    ],
  };
  const out = geo.parseOverpass(data, ['pharmacy'], 19.43, -99.13, 5);
  assert.equal(out.pharmacy.length, 2);
  assert.equal(out.pharmacy[0].name, 'Similares'); // la más cercana primero
  assert.equal(out.pharmacy[0].id, 'way/2');
});

test('dónde comprar: palabras clave de respaldo', () => {
  assert.equal(classifyByKeywords('Paracetamol 500mg'), 'pharmacy');
  assert.equal(classifyByKeywords('Tornillos para madera'), 'hardware');
  assert.equal(classifyByKeywords('Leche'), 'supermarket');
});

test('dónde comprar: usa la respuesta de la IA y agrupa', async () => {
  const { env } = require('../src/config/env');
  env.ai.apiKey = 'clave-falsa';
  const items = [{ id: 1, name: 'Leche' }, { id: 2, name: 'Ibuprofeno' }, { id: 3, name: 'Huevos' }];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"items":[{"i":1,"type":"supermarket"},{"i":2,"type":"pharmacy"},{"i":3,"type":"inventado"}]}' } }],
    }),
  });
  const r = await classifyItems(items, { fetchImpl });
  assert.equal(r.aiUsed, true);
  assert.equal(r.groups[0].type, 'supermarket'); // tipo desconocido cae en súper
  assert.deepEqual(r.groups[0].items.map((i) => i.name), ['Leche', 'Huevos']);
  assert.equal(r.groups[1].label, 'Farmacia');
});

test('dónde comprar: sin IA usa palabras clave', async () => {
  const r = await classifyItems([{ id: 1, name: 'Jarabe para la tos' }], {
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'error' }),
  });
  assert.equal(r.aiUsed, false);
  assert.equal(r.groups[0].type, 'pharmacy');
});

test('lugares: valida coordenadas y categoría', async () => {
  const { places } = require('../src/controllers/modules.controller');
  const bad = await run(places.create, { body: { name: 'Casa', latitude: 200, longitude: 0, category: 'castillo' } });
  assert.equal(bad.error.status, 400);
  assert.ok(bad.error.details.latitude && bad.error.details.category);

  resetCalls();
  setResult({ recordset: [{ Id: 5, Name: 'Iglesia', Latitude: 19.4, Longitude: -99.1 }] });
  const ok = await run(places.create, { body: { name: 'Iglesia', category: 'church', latitude: 19.4, longitude: -99.1 } });
  assert.equal(ok.status, 201);
  assert.match(calls[0].text, /INSERT INTO dbo\.Places \(UserId, Name, Category, Latitude, Longitude\)/);
});

test('geo: coordenadas inválidas devuelven 400', () => {
  const { readCoords } = require('../src/controllers/geo.controller');
  assert.throws(() => readCoords({ lat: 'abc', lon: 1 }), /Coordenadas inválidas/);
  assert.equal(readCoords({}, { required: false }), null);
  assert.deepEqual(readCoords({ lat: '19.4', lon: '-99.1' }), { lat: 19.4, lon: -99.1 });
});

/* ---------------- Salud: perfil, rutinas y calorías ---------------- */
const { computeTargets, estimateBurn } = require('../src/services/health.service');
const { normalizeWorkout, buildUserMessage } = require('../src/services/fitness.service');
const { normalizeEstimate } = require('../src/services/nutrition.service');
const cloudinarySvc = require('../src/services/cloudinary.service');


test('salud: metas con Mifflin-St Jeor', () => {
  const t = computeTargets(
    { sex: 'male', birthYear: 2000, heightCm: 175, weightKg: 75, activityLevel: 'moderate', goal: 'lose' },
    new Date('2026-10-05'),
  );
  // BMR = 10*75 + 6.25*175 - 5*26 + 5 = 1718.75 ; TDEE = 1718.75*1.55 = 2664
  assert.equal(t.bmr, 1719);
  assert.equal(t.tdee, 2664);
  assert.equal(t.calories, 2160); // −500 redondeado a decenas
  assert.equal(t.protein, 150); // 2 g/kg al bajar de peso
  assert.equal(computeTargets(null), null);
  assert.equal(estimateBurn(60, 70), 350);
});

test('rutinas: normaliza el plan y agrega búsqueda de YouTube', () => {
  const plan = normalizeWorkout(
    { title: 'Piernas', exercises: [{ name: 'Sentadilla', sets: 4, reps: '12', restSeconds: 90 }, { name: 'Zancadas', sets: 99 }] },
    { minutes: 40, weightKg: 80 },
  );
  assert.equal(plan.durationMinutes, 40);
  assert.equal(plan.exercises[0].youtubeUrl, 'https://www.youtube.com/results?search_query=Sentadilla%20t%C3%A9cnica%20correcta');
  assert.equal(plan.exercises[1].sets, 10); // tope de seguridad
  assert.ok(plan.estimatedCalories > 0);
});

test('rutinas: el mensaje a la IA incluye historial y limitaciones', () => {
  const msg = buildUserMessage({
    profile: { goal: 'gain', fitnessLevel: 'beginner', equipment: 'gym', limitations: 'rodilla derecha' },
    history: [{ title: 'Pecho', focus: 'pecho', performedAt: '2026-10-04T15:00:00Z' }],
    minutes: 50,
    today: new Date('2026-10-05T15:00:00Z'),
  });
  assert.match(msg, /ganar músculo/);
  assert.match(msg, /rodilla derecha/);
  assert.match(msg, /ayer: Pecho/);
  assert.match(msg, /decide tú/);
});

test('calorías: suma los alimentos de la estimación', () => {
  const e = normalizeEstimate({
    items: [
      { name: 'Taco de pastor', quantity: '2 piezas', calories: 300.4, protein: 14, carbs: 30, fat: 12 },
      { name: 'Refresco', quantity: '355 ml', calories: '140', carbs: 39 },
    ],
    confidence: 'rara',
  });
  assert.equal(e.total.calories, 440);
  assert.equal(e.total.carbs, 69);
  assert.equal(e.confidence, 'media');
  assert.equal(e.description, 'Taco de pastor, Refresco');
});

test('recetas: incluye nutrición por porción', () => {
  const r = normalizeRecipe({ title: 'Ensalada', nutritionPerServing: { calories: 320.6, protein: '12.34', carbs: 20, fat: 18 } });
  assert.deepEqual(r.nutritionPerServing, { calories: 321, protein: 12.3, carbs: 20, fat: 18 });
  assert.equal(normalizeRecipe({ title: 'x' }).nutritionPerServing, null);
});

test('cloudinary: firma de subida (documentación oficial)', () => {
  // Ejemplo de la documentación de Cloudinary
  const sig = cloudinarySvc.sign({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd');
  assert.equal(sig, 'bfd09f95f331f558cbd1320e67aa8d488770583e');
});

test('calorías por foto: analiza con el modelo de visión y no guarda la foto', async () => {
  const { env } = require('../src/config/env');
  env.ai.apiKey = 'clave-falsa';
  const seen = [];
  global.fetch = async (url, init) => {
    seen.push({ url, body: init.body });
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"items":[{"name":"Enchiladas","calories":520}]}' } }] }),
    };
  };
  const health = require('../src/controllers/health.controller');
  const r = await run(health.estimatePhoto, { body: { image: 'A'.repeat(200) } });
  assert.equal(r.body.imageUrl, null);
  assert.equal(r.body.total.calories, 520);
  assert.equal(seen.length, 1); // solo la IA, nada de Cloudinary
  const body = JSON.parse(seen[0].body);
  assert.equal(body.model, env.ai.visionModel);
  assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,AAAA/);
});

test('perfil de salud: valida y guarda con MERGE', async () => {
  const health = require('../src/controllers/health.controller');
  const bad = await run(health.saveProfile, { body: { sex: 'otro', birthYear: 1800 } });
  assert.equal(bad.error.status, 400);

  resetCalls();
  setResult({ recordset: [{ UserId: 7, Sex: 'female', BirthYear: 1995, HeightCm: 160, WeightKg: 60, ActivityLevel: 'light', Goal: 'maintain' }] });
  const ok = await run(health.saveProfile, { body: { sex: 'female', birthYear: 1995, heightCm: 160, weightKg: 60 } });
  assert.equal(ok.status, 200);
  assert.match(calls[0].text, /MERGE dbo\.HealthProfiles/);
  assert.equal(calls[0].params.goal, 'maintain'); // valor por defecto
  assert.ok(ok.body.targets.calories > 1200);
});

/* ---------------- Perfil completo y notificaciones ---------------- */
const notificationsSvc = require('../src/services/notifications.service');
const dailySummary = require('../src/services/daily-summary.job');
const fcmSvc = require('../src/services/fcm.service');

test('notificaciones: normaliza preferencias y descarta valores inválidos', () => {
  const p = notificationsSvc.normalizePrefs({
    timezone: 'Zona/Inventada',
    events: { enabled: false, minutesBefore: 7 },
    todos: { time: '25:00' },
    workout: { enabled: true, days: [1, 1, 9, 3, '5'], time: '19:15' },
    meals: { enabled: true, lunch: '13:45' },
  });
  assert.equal(p.timezone, 'America/Mexico_City');
  assert.equal(p.events.enabled, false);
  assert.equal(p.events.minutesBefore, 15);
  assert.equal(p.todos.time, '09:00');
  assert.deepEqual(p.workout.days, [1, 3, 5]);
  assert.equal(p.workout.time, '19:15');
  assert.equal(p.meals.lunch, '13:45');
  assert.equal(p.meals.breakfast, '08:30');
});

test('resumen diario: hora local según zona horaria y texto', () => {
  const now = new Date('2026-10-05T13:30:00Z'); // 07:30 en Ciudad de México (UTC−6)
  assert.deepEqual(dailySummary.localNow('America/Mexico_City', now), { date: '2026-10-05', time: '07:30' });
  const t = dailySummary.summaryText('Aldahir Ballina', 2, 1);
  assert.equal(t.title, 'Buenos días, Aldahir');
  assert.match(t.body, /2 eventos y 1 pendiente/);
});

test('push: JWT firmado con la cuenta de servicio y tokens inválidos', async () => {
  const crypto = require('node:crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fcmSvc._setAccount({ client_email: 'bot@demo.iam.gserviceaccount.com', private_key: pem, project_id: 'demo' });

  const jwt = fcmSvc.buildJwt({ client_email: 'bot@demo.iam.gserviceaccount.com', private_key: pem }, 1000);
  const [h, p, sig] = jwt.split('.');
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, sig, 'base64url'));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).scope, 'https://www.googleapis.com/auth/firebase.messaging');

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } }),
    };
  };
  const r = await fcmSvc.sendToToken('x'.repeat(30), { title: 'Hola', body: 'Prueba', data: { n: 1 } }, { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.invalidToken, true);
  assert.match(calls[1], /projects\/demo\/messages:send/);
  fcmSvc._setAccount(null);
});

test('perfil: actualiza datos y valida contraseña actual', async () => {
  const users = require('../src/controllers/users.controller');
  resetCalls();
  setResult({ recordset: [{ Id: 7, Name: 'Ana', Email: 'a@b.com', City: 'Montemorelos', BirthDate: new Date('2000-01-02') }] });
  const r = await run(users.updateMe, { body: { city: ' Montemorelos ', birthDate: '2000-01-02', hacker: 1 } });
  assert.equal(r.body.city, 'Montemorelos');
  assert.equal(r.body.birthDate, '2000-01-02');
  assert.match(calls[0].text, /UPDATE dbo\.Users SET BirthDate = @birthDate, City = @city, UpdatedAt/);

  const passwordHash = await require('bcryptjs').hash('correcta', 4);
  setResult({ recordset: [{ PasswordHash: passwordHash }] });
  const bad = await run(users.changePassword, { body: { currentPassword: 'otra', newPassword: 'nuevaClave123' } });
  assert.equal(bad.error.status, 403);
  const ok = await run(users.changePassword, { body: { currentPassword: 'correcta', newPassword: 'nuevaClave123' } });
  assert.equal(ok.body.ok, true);
});

test('cloudinary: URL de avatar recortada a la cara', () => {
  const { avatarUrl } = require('../src/services/cloudinary.service');
  assert.equal(
    avatarUrl('https://res.cloudinary.com/demo/image/upload/v1/multiapp/avatars/user_7.jpg'),
    'https://res.cloudinary.com/demo/image/upload/c_fill,g_face,w_256,h_256,q_auto,f_auto/v1/multiapp/avatars/user_7.jpg',
  );
});

/* ---------------- Presupuesto y apartados ---------------- */
const period = require('../src/services/budget-period.service');

test('presupuesto: periodos mensual, quincenal y semanal', () => {
  assert.deepEqual(period.periodFor({ period: 'monthly', startDay: 1 }, '2026-10-05'), {
    period: 'monthly', startDate: '2026-10-01', endDate: '2026-10-31',
  });
  // Mensual desde el día 15 (quincena de pago): 15 sep – 14 oct
  assert.deepEqual(period.periodFor({ period: 'monthly', startDay: 15 }, '2026-10-05'), {
    period: 'monthly', startDate: '2026-09-15', endDate: '2026-10-14',
  });
  assert.equal(period.periodFor({ period: 'monthly', startDay: 15 }, '2026-12-20').endDate, '2027-01-14');
  assert.deepEqual(period.periodFor({ period: 'biweekly' }, '2026-02-20'), {
    period: 'biweekly', startDate: '2026-02-16', endDate: '2026-02-28',
  });
  assert.equal(period.periodFor({ period: 'biweekly' }, '2026-10-15').endDate, '2026-10-15');
  // 5 oct 2026 es lunes; semana que empieza en domingo (7) → 4 al 10 de octubre
  assert.deepEqual(period.periodFor({ period: 'weekly', startDay: 7 }, '2026-10-05'), {
    period: 'weekly', startDate: '2026-10-04', endDate: '2026-10-10',
  });
  assert.equal(period.periodFor({ period: 'weekly', startDay: 1 }, '2026-10-04').startDate, '2026-09-28');
});

test('presupuesto: días locales a UTC en la zona del usuario', () => {
  // Ciudad de México es UTC−6 todo el año
  assert.equal(period.zonedDayStart('2026-10-05', 'America/Mexico_City').toISOString(), '2026-10-05T06:00:00.000Z');
  // Nueva York en horario de verano (UTC−4)
  assert.equal(period.zonedDayStart('2026-07-01', 'America/New_York').toISOString(), '2026-07-01T04:00:00.000Z');
  assert.equal(period.localDate(new Date('2026-10-05T03:00:00Z'), 'America/Mexico_City'), '2026-10-04');
  const r = period.periodRange('2026-10-01', '2026-10-31', 'America/Mexico_City');
  assert.equal(r.to.toISOString(), '2026-11-01T06:00:00.000Z');
  assert.equal(period.isValidDate('2026-02-30'), false);
});

test('presupuesto: alerta solo al cruzar 80 % o 100 %', () => {
  const { crossedLevel } = require('../src/services/budget.service');
  assert.equal(crossedLevel(700, 850, 1000), 80);
  assert.equal(crossedLevel(850, 900, 1000), null);
  assert.equal(crossedLevel(900, 1000, 1000), 100);
  assert.equal(crossedLevel(500, 1200, 1000), 100);
  assert.equal(crossedLevel(1100, 1200, 1000), null);
});

test('presupuesto: guardar límites valida cada renglón', async () => {
  const budgetCtl = require('../src/controllers/budget.controller');
  resetCalls();
  setResult({ recordset: [] });
  const r = await run(budgetCtl.updatePeriod, { params: { id: '3' }, body: { limits: [{ categoryId: 'x', amount: 10 }] } });
  assert.equal(r.error.status, 400);
  assert.equal(calls.length, 0);
});

test('apartados: no se puede retirar más del saldo', async () => {
  const budgetCtl = require('../src/controllers/budget.controller');
  resetCalls();
  setResult((text) => (/FROM dbo\.SavingsFunds f/.test(text)
    ? { recordset: [{ Id: 4, Name: 'Emergencias', Balance: 500, Goal: null, AutoType: 'none', IsArchived: false }] }
    : { recordset: [] }));
  const r = await run(budgetCtl.addMovement, { params: { id: '4' }, body: { type: 'withdraw', amount: 800 } });
  assert.equal(r.error.status, 400);
  assert.match(r.error.message, /Emergencias/);
  assert.ok(!calls.some((c) => /INSERT INTO dbo\.FundMovements/.test(c.text)));
});

test('apartados: porcentaje automático máximo 100', async () => {
  const budgetCtl = require('../src/controllers/budget.controller');
  const r = await run(budgetCtl.createFund, { body: { name: 'Ahorro', autoType: 'percent', autoValue: 150 } });
  assert.equal(r.error.status, 400);
});

test('presupuesto: consejos de IA normalizados', async () => {
  const budgetCtl = require('../src/controllers/budget.controller');
  const n = budgetCtl.normalizeInsights({ resumen: ' Vas bien ', aciertos: ['a', '', 3], consejos: ['x', 'y', 'z', 'w'], ahorroSugerido: '1200.6' });
  assert.deepEqual(n, { summary: 'Vas bien', wins: ['a'], warnings: [], tips: ['x', 'y', 'z'], suggestedSavings: 1201 });
  // Sin ingreso ni gastos no se llama a la IA
  const empty = await budgetCtl.generateInsights(
    { period: { startDate: '2026-10-01', endDate: '2026-10-31', daysLeft: 20 }, categories: [], totals: { income: null, spent: 0 } },
    [],
    { fetchImpl: () => { throw new Error('no debe llamarse'); } },
  );
  assert.match(empty.summary, /Aún no hay suficiente/);
});

test('resumen diario: no consulta la base si a nadie le toca (Azure se puede pausar)', async () => {
  const job = require('../src/services/daily-summary.job');
  const fcmSvc = require('../src/services/fcm.service');
  fcmSvc._setAccount({ project_id: 'demo', client_email: 'x@demo', private_key: 'k' });
  const prefs = JSON.stringify({ timezone: 'America/Mexico_City', dailySummary: { enabled: true, time: '07:30' } });
  setResult({ recordset: [{ Id: 5, NotificationPrefs: prefs }] });
  // Primera vuelta: carga la agenda una sola vez
  await job.runOnce(new Date('2026-10-05T13:00:00Z'));
  resetCalls();
  // 7:29 en CDMX (13:29 UTC): a nadie le toca → cero consultas
  assert.equal(await job.runOnce(new Date('2026-10-05T13:29:00Z')), 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(job.dueUsers(new Date('2026-10-05T13:30:00Z')).map((d) => d.userId), [5]);
  assert.deepEqual(job.dueUsers(new Date('2026-10-05T13:31:00Z')), []);
  fcmSvc._setAccount(null);
  job._schedule.clear();
});

test('migración: se saltan CREATE DATABASE y USE (Azure no los permite)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { batches } = require('../scripts/migrate');
  const list = batches(fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'));
  assert.ok(list.length > 10);
  assert.ok(!list.some((b) => /CREATE\s+DATABASE/i.test(b)));
  assert.ok(!list.some((b) => /^\s*USE\s/im.test(b)));
  assert.ok(list.some((b) => /CREATE TABLE dbo\.SavingsFunds/.test(b)));
});
