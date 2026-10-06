# Subir MultiApp a internet: Render (API) + Azure SQL (base de datos)

```
 App (iPhone / Android) ──https──▶ Render: multiapp-api ──TLS──▶ Azure SQL (serverless, gratis)
                                     ▲
                    cron-job.org ────┘  (ping cada 10 min para que no se duerma)
```

**Costo: $0** si te quedas dentro de los planes gratuitos:

| Servicio | Plan gratis | Detalle importante |
|---|---|---|
| Render | 750 h/mes (alcanza para 1 servicio 24/7) | Se duerme tras 15 min sin tráfico y tarda ~1 min en despertar → lo evitamos con un ping |
| Azure SQL | 1 base: 100,000 "vCore-segundos"/mes + 32 GB | Solo cuenta mientras la base está **despierta**; se pausa sola sin uso |

> **Por qué importa la pausa de Azure:** la base cobra mínimo 0.5 vCore mientras está despierta, así que
> 100,000 vCore-segundos ≈ 55 horas despierta al mes. Con pausa automática a los 15 min alcanza para uso
> personal diario. El backend ya está preparado: no deja conexiones abiertas, el ping de Render **no** toca
> la base y el resumen diario solo consulta la base a la hora de enviar.

---

## 1. Base de datos en Azure SQL

1. Entra a [portal.azure.com](https://portal.azure.com) y crea tu cuenta (Azure suele pedir una tarjeta para
   verificar identidad; con la oferta gratuita no se cobra mientras no actives cobros extra).
2. Busca **"Azure SQL"** → **Crear** → **Bases de datos SQL – Base de datos única**.
   Arriba aparece el aviso **"¿Quiere probar Azure SQL Database gratis?"** → **Aplicar oferta**.
3. Llena:
   - **Grupo de recursos:** nuevo → `multiapp-rg`
   - **Nombre de la base:** `multiapp`
   - **Servidor:** *Crear nuevo*
     - Nombre: `multiapp-sql-TUNOMBRE` (debe ser único en todo Azure)
     - Ubicación: **(US) East US** (junto a Render "Virginia")
     - Autenticación: **Usar autenticación de SQL** → usuario (p. ej. `multiappadmin`) y una contraseña fuerte. **Guárdalas.**
   - **Comportamiento al alcanzar el límite gratuito:** **Pausar automáticamente la base hasta el próximo mes**
     (así nunca te cobran).
4. Pestaña **Redes**:
   - Método de conectividad: **Punto de conexión público**
   - **Permitir que los servicios de Azure accedan:** No
   - **Agregar la dirección IP del cliente actual:** **Sí** (para correr la migración desde tu Mac)
5. **Revisar y crear** → **Crear** (tarda unos minutos).
6. Ya creada, en la base → **Proceso y almacenamiento**: confirma que **Pausa automática** esté activada y pon
   el retraso en el mínimo que te deje (15 min o 1 h).

### Crear las tablas

En tu Mac, edita `multiAppBack/.env` (guarda tu configuración local en otro lado si la quieres conservar):

```env
DB_SERVER=multiapp-sql-TUNOMBRE.database.windows.net
DB_PORT=1433
DB_NAME=multiapp
DB_USER=multiappadmin
DB_PASSWORD=la-contraseña-que-elegiste
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=false
```

```bash
cd multiAppBack
npm run db:migrate
```

Debe terminar con `✔ Listo: la base tiene 18 tablas.` La primera conexión puede tardar ~1 min si la base
estaba pausada (el backend reintenta solo).

---

## 2. API en Render

1. Sube el código a GitHub (repositorio **privado**). Los archivos secretos ya están en `.gitignore`:
   `.env`, `firebase-service-account.json`, `*.p8`, `key.properties`, `*.jks`.
2. Entra a [render.com](https://render.com) con tu cuenta de GitHub.
3. **New → Blueprint** → elige tu repositorio. Render lee `render.yaml` (en la raíz del repo) y te pide los
   valores marcados como secretos:

   | Variable | Valor |
   |---|---|
   | `DB_SERVER` | `multiapp-sql-TUNOMBRE.database.windows.net` |
   | `DB_NAME` | `multiapp` |
   | `DB_USER` / `DB_PASSWORD` | los de Azure |
   | `AI_API_KEY` | tu clave de Groq |
   | `CLOUDINARY_URL` | la de tu Dashboard de Cloudinary |
   | `GEO_CONTACT_EMAIL` | tu correo |

   `JWT_SECRET` lo genera Render solo. Deja **Blueprint Path** vacío (usa `render.yaml` de la raíz del repo).
4. **Notificaciones push:** en el servicio → **Environment → Secret Files → Add Secret File**
   - Filename: `firebase-service-account.json`
   - Contents: pega el contenido completo de tu archivo `firebase-service-account.json`
5. Espera el primer deploy y abre `https://multiapp-api.onrender.com/api/health` (o la URL que te dé Render).
   Debe responder `{"status":"ok",...}`.

### Dejar entrar a Render en Azure

Render se conecta desde unas IP fijas por región:

1. En Render → tu servicio → **Connect** (arriba a la derecha) → pestaña **Outbound** → copia los rangos de IP.
2. En Azure → tu **servidor SQL** → **Redes** → **Reglas de firewall** → agrega una regla por rango
   (Inicio = primera IP, Fin = última IP del rango) → **Guardar**.

> Atajo (menos seguro): una sola regla `0.0.0.0` – `255.255.255.255`. La base sigue protegida por usuario,
> contraseña y TLS, pero queda expuesta a intentos de login desde cualquier lugar.

En los logs de Render debe aparecer `✔ Conectado a SQL Server (...)` y `✔ Notificaciones push activas`.

---

## 3. Que Render no se duerma

1. Crea cuenta gratis en [cron-job.org](https://cron-job.org).
2. **Create cronjob**:
   - URL: `https://multiapp-api.onrender.com/api/health`
   - Cada **10 minutos**
3. Guardar. Este ping no toca la base, así que Azure se sigue pausando cuando no usas la app.

---

## 4. Conectar la app

La app ya usa `https://multiapp-api.onrender.com/api` en las versiones de tienda (release).
Si Render le puso otro nombre a tu servicio, cámbialo en `multiAppFront/lib/core/config.dart` (`productionUrl`).

Para probar contra el servidor desde el emulador o tu teléfono:

```bash
flutter run --dart-define=API_URL=https://multiapp-api.onrender.com/api
```

---

## Actualizar

Cada `git push` a la rama principal redepliega Render solo. Si cambias la base (nueva migración), corre
`npm run db:migrate` desde tu Mac con el `.env` apuntando a Azure.

## Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `Client with IP address ... is not allowed` | Falta esa IP en el firewall de Azure (paso 2 "Dejar entrar a Render") |
| La primera petición tarda ~1 min o falla una vez | La base estaba pausada y está despertando; el backend reintenta solo |
| `Login failed for user` | Usuario o contraseña de Azure mal escritos en Render |
| La base dejó de responder a fin de mes | Se agotaron los 100,000 vCore-segundos; vuelve el día 1 (revisa que nada deje conexiones abiertas, p. ej. Azure Data Studio) |
| Render dice "Deploy failed" en `npm ci` | Falta subir `package-lock.json` al repo |
