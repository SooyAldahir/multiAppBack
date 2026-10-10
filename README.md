# multiApp · Backend (Express + SQL Server)

API REST de multiApp. Autenticación con JWT, cada usuario solo ve sus propios datos.

## Requisitos

- Node.js 18 o superior
- SQL Server 2016+ (local, Docker o Azure SQL)

## Puesta en marcha

```bash
cd multiAppBack
npm install
cp .env.example .env          # edita credenciales de SQL Server, JWT_SECRET y AI_API_KEY
```

Crea la base de datos y tablas (SSMS, Azure Data Studio o sqlcmd):

```bash
sqlcmd -S localhost -U sa -P "TuPassword" -i database/schema.sql
```

> En Mac puedes levantar SQL Server con Docker:
> `docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=TuPasswordSegura123!" -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest`

Inicia el servidor:

```bash
npm run dev     # con recarga automática
npm start       # producción
npm test        # pruebas unitarias (no necesitan SQL Server)
```

Comprueba que responde: `GET http://localhost:3000/api/health`

## Estructura

```
database/schema.sql            Tablas: Users, Events, Notes, Todos, Expenses, ShoppingItems, Recipes
src/
  server.js                    Arranque y conexión a SQL Server
  app.js                       Middlewares (helmet, cors, json, logs) y rutas
  config/env.js, db.js         Variables de entorno y pool de conexiones (mssql)
  middleware/auth.js           Verificación del token JWT
  middleware/errors.js         404 y manejo centralizado de errores
  controllers/crud.controller  Fábrica CRUD reutilizable (filtra siempre por UserId)
  controllers/modules...       Agenda, Notas, ToDo, Gastos, Lista de compras
  controllers/dashboard...     Resumen de "Hoy" y feed de Actividad
  controllers/recipes...       Recetario con IA
  services/ai.service.js       Llamada a la IA (Groq por defecto, formato compatible con OpenAI)
  utils/validator.js           Validación por lista blanca de campos
  validators/schemas.js        Reglas de cada módulo
test/                          Pruebas con node:test
```

## Subir a internet

Guía paso a paso (Render + Azure SQL): [DEPLOY.md](DEPLOY.md). Crear/actualizar tablas en cualquier base: `npm run db:migrate`.

## Endpoints

Todas las rutas (excepto registro, login y health) requieren el header `Authorization: Bearer <token>`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` → `{ token, user }` |
| POST | `/api/auth/login` | `{ email, password }` → `{ token, user }` |
| POST | `/api/auth/google` | `{ idToken }` → `{ token, user, created }` (crea o vincula la cuenta) |
| POST | `/api/auth/apple` | `{ idToken, authorizationCode?, name? }` → `{ token, user, created }` |
| GET | `/api/auth/me` | Usuario actual |
| GET/PATCH | `/api/users/me` | Perfil / `{ name?, phone?, birthDate?, city?, bio? }` |
| DELETE | `/api/users/me` | `{ password }` o `{ provider, idToken }` elimina la cuenta, su foto y revoca Apple |
| POST/DELETE | `/api/users/me/avatar` | `{ image (base64) }` sube la foto de perfil a Cloudinary / la quita |
| PUT | `/api/users/me/password` | `{ currentPassword, newPassword }` (sin `currentPassword` si la cuenta es de Google/Apple) |
| PUT | `/api/users/me/email` | `{ email, password }` → `{ token, user }` |
| GET/PUT | `/api/users/me/notifications` | Preferencias de notificaciones (+ `pushAvailable`) |
| POST | `/api/devices` | `{ token, platform }` registra el teléfono para push (FCM) |
| DELETE | `/api/devices/:token` | Lo da de baja (al cerrar sesión) |
| POST | `/api/notifications/test` | Envía un push de prueba a mis teléfonos |
| GET | `/api/dashboard?from=ISO&to=ISO` | Eventos del día, pendientes principales y contadores |
| GET | `/api/activity?limit=20&module=todo` | Últimos cambios en todos los módulos |
| GET/POST | `/api/events` | Lista (`?from=&to=`) / crea evento |
| GET/PATCH/DELETE | `/api/events/:id` | Detalle / edita / elimina |
| GET/POST | `/api/notes` | Lista (`?q=texto`) / crea nota |
| GET/PATCH/DELETE | `/api/notes/:id` | |
| GET/POST | `/api/todos` | Lista (`?status=pending\|completed`) / crea tarea |
| GET/PATCH/DELETE | `/api/todos/:id` | `PATCH { isCompleted: true }` marca como hecha |
| GET/POST | `/api/expenses` | Gastos (`?from=&to=`) |
| GET | `/api/expenses/summary` | Total y total por categoría |
| GET/PATCH/DELETE | `/api/expenses/:id` | |
| GET/PUT | `/api/budget/settings` | Periodo (`monthly`, `biweekly`, `weekly`), día de inicio, alertas, apartado para el sobrante |
| GET/POST | `/api/budget/categories` | Categorías (las mismas de Gastos; la primera vez se crean las predeterminadas) |
| PATCH/DELETE | `/api/budget/categories/:id` | Renombrar actualiza los gastos; borrar los pasa a "Otros" |
| GET | `/api/budget/current?date=YYYY-MM-DD` | Periodo actual (se crea copiando los límites del anterior) con gastado por categoría y totales |
| GET | `/api/budget/periods` | Historial de periodos |
| GET/PUT | `/api/budget/periods/:id` | `{ income?, limits?: [{ categoryId, amount }] }` (el ingreso dispara el ahorro automático) |
| POST | `/api/budget/periods/:id/close` | `{ fundId? }` cierra el periodo y manda lo que sobró a un apartado |
| POST | `/api/budget/periods/:id/insights` | Resumen y consejos con IA |
| GET/POST | `/api/funds` | Apartados (Ahorro, Emergencias, Medicamentos…) con saldo, meta y regla automática |
| GET/PATCH/DELETE | `/api/funds/:id` | Detalle con historial de movimientos |
| POST | `/api/funds/:id/movements` | `{ type: deposit\|withdraw, amount, note?, movedAt? }` |
| DELETE | `/api/funds/movements/:id` | Borra un movimiento |
| GET/POST | `/api/shopping` | Lista de compras |
| POST | `/api/shopping/bulk` | `{ items: [{ name, quantity? }] }` agrega varios (ej. ingredientes de una receta) |
| DELETE | `/api/shopping/checked` | Borra los artículos ya comprados |
| GET/PATCH/DELETE | `/api/shopping/:id` | |
| POST | `/api/shopping/where-to-buy` | `{ lat?, lon? }` agrupa lo pendiente por tipo de tienda (IA) y agrega las tiendas cercanas |
| GET/POST | `/api/places` | Lugares guardados (casa, trabajo, iglesia…) |
| GET/PATCH/DELETE | `/api/places/:id` | |
| GET | `/api/geo/search?q=&lat=&lon=` | Buscar direcciones (OpenStreetMap / Nominatim) |
| GET | `/api/geo/reverse?lat=&lon=` | Dirección de unas coordenadas |
| GET | `/api/geo/nearby?lat=&lon=&types=supermarket,pharmacy` | Tiendas cercanas (Overpass) |
| GET/PUT | `/api/health/profile` | Perfil de salud y metas diarias (calorías y macros) |
| POST | `/api/workouts/generate` | `{ focus?, minutes?, notes? }` rutina con IA (incluye búsqueda de YouTube por ejercicio) |
| GET/POST | `/api/workouts` | Historial / guardar entrenamiento terminado (también se agrega a la Agenda) |
| GET/DELETE | `/api/workouts/:id` | |
| POST | `/api/nutrition/estimate` | `{ text }` calorías y macros estimados con IA |
| POST | `/api/nutrition/estimate-photo` | `{ image (base64), note? }` estima con foto (la foto no se guarda) |
| GET | `/api/nutrition/summary?from=&to=` | Consumido, quemado y metas del día |
| GET/POST | `/api/food-logs` | Comidas registradas (`?from=&to=`) |
| GET/PATCH/DELETE | `/api/food-logs/:id` | |
| POST | `/api/recipes/generate` | `{ prompt, servings?, save? }` → receta generada por IA |
| GET/POST | `/api/recipes` | Recetas guardadas / guardar una receta |
| GET/DELETE | `/api/recipes/:id` | |

Las fechas viajan en formato ISO 8601 y se guardan en UTC. Las respuestas usan camelCase.

### Ejemplo

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Aldahir","email":"aldahir@ejemplo.com","password":"secreto123"}'

curl http://localhost:3000/api/todos -H "Authorization: Bearer <token>"
```

## IA del recetario

Por defecto usa **Groq** con su nivel gratuito (sin tarjeta).

1. Entra a https://console.groq.com/keys, inicia sesión (Google, GitHub o correo) y pulsa **Create API Key**.
2. Pégala en `.env` → `AI_API_KEY=...`
3. Verifica con `npm run ai:check` (lista los modelos disponibles y genera una receta de prueba).

Para cambiar de proveedor solo edita `AI_BASE_URL`, `AI_API_KEY` y `AI_MODEL`:

| Proveedor | AI_BASE_URL | AI_MODEL (ejemplo) |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` (clave: cualquier texto) |

> El nivel gratuito tiene límites por minuto y por día; si se superan, la app muestra "Se alcanzó el límite gratuito de la IA".

## Ejercicio y calorías

- Si ya tenías la base creada, ejecuta `database/migrations/003_health.sql`.
- Las metas usan la fórmula de Mifflin-St Jeor según el perfil (sexo, edad, estatura, peso, actividad y objetivo).
- Las rutinas y las calorías son **estimaciones de la IA**: sirven como guía, no sustituyen a un profesional.
- Fotos: el análisis usa `AI_VISION_MODEL` (Groq). La foto solo se analiza; no se guarda.

## Presupuesto y apartados

- Si ya tenías la base creada, ejecuta `database/migrations/005_budget_savings.sql`.
- Periodos con fechas locales del usuario (zona horaria de sus preferencias de notificaciones).
- Al crear un gasto, la respuesta trae `budgetAlert` si su categoría cruzó el 80 % o el 100 % del límite.
- Los apartados solo registran movimientos: el dinero puede estar en el banco, en efectivo o donde sea.

## Perfil y notificaciones

- Si ya tenías la base creada, ejecuta `database/migrations/004_profile_notifications.sql`.
- **Foto de perfil (Cloudinary):** crea una cuenta gratis en https://cloudinary.com, copia el
  *API environment variable* del Dashboard a `CLOUDINARY_URL`. Cada usuario tiene una sola foto
  (`multiapp/avatars/user_<id>`) que se sobrescribe; se entrega recortada a la cara en 256×256.
- **Recordatorios locales** (eventos, tareas, ejercicio, comidas): los programa la app en el
  teléfono; funcionan sin internet y sin Firebase.
- **Push (Firebase Cloud Messaging):** Firebase Console → Configuración del proyecto → Cuentas de
  servicio → *Generar nueva clave privada*. Guarda el JSON como `firebase-service-account.json`
  (está en `.gitignore`) y pon `FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json`.
  Verifica con `npm run push:check` (o `npm run push:check -- tu@correo.com` para mandar un push de prueba).
  El servidor manda cada mañana el **resumen del día** a la hora que elija cada usuario (en su zona horaria).

## Mapas y lugares

Se usan datos abiertos de **OpenStreetMap**: no requiere clave ni tarjeta.

- Direcciones: Nominatim (máximo 1 búsqueda por segundo; el backend las espacía y guarda en caché 10 min).
- Tiendas cercanas: Overpass API.
- Verifica con `npm run geo:check` (o `npm run geo:check -- "Tu ciudad"`).
- Si ya tenías la base creada, ejecuta `database/migrations/002_places.sql` para agregar la tabla `Places`.
- La navegación paso a paso la hacen Google Maps, Waze o Apple Maps: la app solo los abre con el destino.

## Agregar un módulo nuevo

1. Crea la tabla en `database/schema.sql` (con `UserId`, `CreatedAt`, `UpdatedAt`).
2. Define su esquema en `src/validators/schemas.js`.
3. Crea el controlador con `createCrudController({ table, schema, orderBy })`.
4. Regístralo en `src/routes/index.js` con `crudRoutes(...)`.
# multiAppBack


## Páginas públicas (App Store / Google Play)

| Ruta | Para qué |
|---|---|
| `/privacidad` | Aviso de privacidad integral (LFPDPPP). URL para App Store Connect y Play Console |
| `/terminos` | Términos y condiciones |
| `/eliminar-cuenta` | Pasos y formulario para eliminar la cuenta sin la app (lo exige Google Play) |
| `/soporte` | Contacto y preguntas frecuentes (Support URL de App Store) |
| `/.well-known/apple-app-site-association` | Permite guardar la contraseña en el Llavero de iOS |
| `/.well-known/assetlinks.json` | Lo mismo para Google (requiere `ANDROID_SHA256_FINGERPRINTS`) |

Los datos del responsable salen de `LEGAL_OWNER_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_ADDRESS` y `LEGAL_CITY`.
Los textos están en `src/web/legal-content.js`; si los cambias, actualiza `LAST_UPDATED`.
