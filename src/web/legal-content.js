/**
 * Textos legales de MultiApp (aviso de privacidad, términos, eliminación de cuenta y soporte).
 * Los datos del responsable salen de las variables LEGAL_* (ver .env.example).
 *
 * IMPORTANTE: son una base redactada conforme a la LFPDPPP (DOF 20/03/2025) y a las políticas de
 * App Store y Google Play. Antes de publicar la app conviene que un abogado en México los revise.
 * Si cambias algo importante, actualiza LAST_UPDATED.
 */
const LAST_UPDATED = '10 de octubre de 2026';

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function contactLink(l) {
  return l.contactEmail ? `<a href="mailto:${esc(l.contactEmail)}">${esc(l.contactEmail)}</a>` : '<em>(correo de contacto pendiente)</em>';
}

function addressText(l) {
  return l.address ? esc(l.address) : '<em>(domicilio pendiente: configura LEGAL_ADDRESS)</em>';
}

/* ======================================================================================= */

function privacy(l, base) {
  const app = esc(l.appName);
  const owner = esc(l.ownerName);
  return `
<h1>Aviso de privacidad integral</h1>
<p class="muted">Última actualización: ${LAST_UPDATED}</p>

<p>Este aviso explica qué datos personales trata <strong>${app}</strong> (la "App"), para qué, con quién se
comparten y cómo puedes ejercer tus derechos, conforme a la Ley Federal de Protección de Datos Personales en
Posesión de los Particulares (LFPDPPP) y demás normativa aplicable.</p>

<h2 id="responsable">1. Responsable</h2>
<p><strong>${owner}</strong>, persona física, desarrollador de ${app}, es responsable del tratamiento de tus datos
personales. Domicilio para oír y recibir notificaciones: ${addressText(l)}. Correo de contacto y de privacidad:
${contactLink(l)}.</p>

<h2 id="datos">2. Datos personales que tratamos</h2>
<p>Solo tratamos los datos que tú nos das al usar la App o que se generan al usarla:</p>
<ul>
  <li><strong>Identificación y contacto:</strong> nombre, correo electrónico y, si decides agregarlos, teléfono,
      fecha de nacimiento, ciudad, una breve descripción y tu foto de perfil.</li>
  <li><strong>Datos de acceso:</strong> tu contraseña (guardada solo de forma cifrada e irreversible) o, si entras con
      Google o Apple, el identificador de esa cuenta y el correo que el proveedor nos comparte (Apple puede darnos un
      correo de reenvío privado).</li>
  <li><strong>Contenido que registras:</strong> eventos de agenda, notas, pendientes, lista de compras, recetas,
      lugares guardados y los textos que escribes para las funciones de inteligencia artificial.</li>
  <li><strong>Datos financieros que tú capturas:</strong> gastos, categorías, presupuestos y apartados de ahorro.
      <em>No</em> pedimos ni guardamos números de tarjeta, cuentas bancarias ni contraseñas de bancos.</li>
  <li><strong>Ubicación:</strong> tu ubicación precisa, solo mientras usas los mapas (lugares y "¿Dónde compro?") y
      solo con tu permiso. No la rastreamos en segundo plano ni guardamos un historial de dónde estás; solo se guardan
      las coordenadas de los lugares que tú decides guardar.</li>
  <li><strong>Datos del dispositivo:</strong> el token para enviarte notificaciones, el tipo de sistema (iOS/Android),
      tu zona horaria y tus preferencias de notificación. También, como cualquier servidor, registros técnicos
      temporales (dirección IP, fecha y ruta de cada petición) para seguridad.</li>
</ul>

<h3 id="sensibles">Datos personales sensibles</h3>
<p>Si usas los módulos de Ejercicio y Calorías, tratamos datos que pueden revelar aspectos de tu <strong>estado de
salud</strong>: sexo, año de nacimiento, estatura, peso, nivel de actividad y de condición física, objetivo,
limitaciones o lesiones que describas, rutinas realizadas, comidas registradas y las fotos de comida que envíes para
calcular calorías. Estos datos son <strong>opcionales</strong> y solo se tratan con tu <strong>consentimiento
expreso</strong>, que otorgas al marcar la casilla correspondiente al crear tu cuenta o al usar esas funciones por
primera vez. Puedes revocarlo en cualquier momento (sección 7).</p>

<h2 id="finalidades">3. Finalidades</h2>
<p>Tratamos tus datos para estas finalidades, que son <strong>necesarias</strong> para darte el servicio:</p>
<ol>
  <li>Crear, autenticar y administrar tu cuenta, incluido el inicio de sesión con Google o Apple.</li>
  <li>Guardar, sincronizar y mostrarte tu información en los módulos de la App.</li>
  <li>Generar, cuando tú lo pides, recetas, rutinas, estimaciones de calorías, sugerencias de presupuesto y la
      clasificación de tu lista de compras mediante inteligencia artificial.</li>
  <li>Mostrarte tiendas cercanas, mapas y rutas a tus lugares.</li>
  <li>Enviarte los recordatorios y notificaciones que configures.</li>
  <li>Mantener la seguridad de la App, prevenir abusos y atender tus solicitudes de soporte y de derechos ARCO.</li>
</ol>
<p><strong>No</strong> usamos tus datos para publicidad, mercadotecnia ni perfiles comerciales, <strong>no</strong>
los vendemos y <strong>no</strong> usamos herramientas de rastreo, analítica de terceros ni cookies publicitarias.
Por eso no hay finalidades secundarias.</p>

<h2 id="encargados">4. Proveedores que nos ayudan (encargados) y transferencias</h2>
<p>Para funcionar, la App usa proveedores que tratan datos <strong>por cuenta nuestra</strong> y solo para prestarnos
su servicio. Varios se ubican en <strong>Estados Unidos</strong>, por lo que tus datos se almacenan y procesan fuera
de México:</p>
<ul>
  <li><strong>Render</strong> (EE. UU.): servidor donde funciona la App.</li>
  <li><strong>Microsoft Azure</strong> (EE. UU.): base de datos donde se guarda tu información.</li>
  <li><strong>Groq</strong> (EE. UU.): genera las respuestas de inteligencia artificial. Solo recibe el texto, la foto
      de comida o los datos necesarios para la solicitud que haces (por ejemplo, tu perfil de ejercicio para armar una
      rutina, o tu lista de compras para clasificarla). No le enviamos tu nombre ni tu correo. Las fotos de comida no
      se guardan en nuestros servidores. Antes de tu primer uso de estas funciones te pedimos permiso en la App.</li>
  <li><strong>Cloudinary</strong>: almacena tu foto de perfil.</li>
  <li><strong>Google Firebase Cloud Messaging</strong>: entrega las notificaciones push.</li>
  <li><strong>Google</strong> y <strong>Apple</strong>: solo si eliges iniciar sesión con ellos.</li>
  <li><strong>OpenStreetMap</strong> (Nominatim y Overpass): convierten direcciones en coordenadas y buscan tiendas
      cercanas. Reciben coordenadas o el texto de búsqueda, no tu identidad.</li>
</ul>
<p>No realizamos <strong>transferencias</strong> de tus datos a terceros para que los usen con fines propios, salvo
las que exija la ley o una autoridad competente, o las demás previstas en el artículo 36 de la LFPDPPP, que no
requieren tu consentimiento.</p>

<h2 id="limitar">5. Cómo limitar el uso de tus datos</h2>
<ul>
  <li>Puedes no llenar los datos opcionales del perfil ni usar los módulos de salud.</li>
  <li>Puedes negar o retirar los permisos de ubicación, cámara, fotos y notificaciones en los ajustes de tu teléfono.</li>
  <li>Puedes desactivar recordatorios y el resumen diario en <em>Perfil → Notificaciones</em>.</li>
  <li>Puedes no usar las funciones de inteligencia artificial o retirar tu permiso para ellas.</li>
</ul>

<h2 id="conservacion">6. Cuánto tiempo guardamos tus datos</h2>
<p>Conservamos tus datos mientras tengas tu cuenta. Al <a href="${base}/eliminar-cuenta">eliminar tu cuenta</a> se
borran de inmediato de nuestra base de datos, junto con tu foto de perfil, y se revoca el acceso de Sign in with
Apple si lo usaste. Las copias de seguridad automáticas de la base de datos se sobrescriben en un plazo máximo de
<strong>35 días</strong> y los registros técnicos del servidor se eliminan en un máximo de <strong>30 días</strong>.
Solo conservaríamos algo por más tiempo si una ley o una autoridad nos lo exige.</p>

<h2 id="arco">7. Derechos ARCO y revocación del consentimiento</h2>
<p>Tienes derecho a <strong>Acceder</strong> a tus datos, <strong>Rectificarlos</strong>, <strong>Cancelarlos</strong>
y <strong>Oponerte</strong> a su tratamiento, así como a <strong>revocar tu consentimiento</strong>. Muchas cosas
puedes hacerlas tú mismo en la App: ver y editar tu perfil, borrar cualquier registro y eliminar tu cuenta.
Para cualquier otra solicitud escribe a ${contactLink(l)} indicando:</p>
<ul>
  <li>tu nombre y el correo de tu cuenta en ${app}, para responderte;</li>
  <li>el derecho que quieres ejercer y una descripción clara de los datos;</li>
  <li>en su caso, un documento que acredite tu identidad o la de tu representante.</li>
</ul>
<p>Te responderemos en un máximo de <strong>20 días hábiles</strong> y, si la solicitud procede, la haremos
efectiva dentro de los <strong>15 días hábiles</strong> siguientes. Si crees que no atendimos tu solicitud
correctamente, puedes acudir a la autoridad en materia de protección de datos personales (actualmente la Secretaría
Anticorrupción y Buen Gobierno).</p>

<h2 id="menores">8. Menores de edad</h2>
<p>La App no está dirigida a menores de 13 años. Si tienes entre 13 y 17 años, necesitas el consentimiento de tu
madre, padre o tutor para usarla. Si sabemos que tenemos datos de un menor sin ese consentimiento, los eliminaremos.</p>

<h2 id="seguridad">9. Seguridad</h2>
<p>Usamos conexiones cifradas (HTTPS/TLS), contraseñas cifradas de forma irreversible, sesiones con vencimiento y
guardamos tu sesión en el almacenamiento seguro del teléfono (Llavero de iOS o Keystore de Android). Ningún sistema
es 100% seguro; si ocurriera una vulneración que afecte tus derechos, te lo informaremos.</p>

<h2 id="cookies">10. Cookies y rastreo</h2>
<p>La App y este sitio no usan cookies, píxeles ni tecnologías de rastreo con fines publicitarios o de analítica.</p>

<h2 id="cambios">11. Cambios a este aviso</h2>
<p>Publicaremos cualquier cambio en <a href="${base}/privacidad">${base}/privacidad</a> con su fecha de actualización.
Si el cambio es importante (por ejemplo, nuevas finalidades), te avisaremos en la App y, cuando la ley lo pida, te
pediremos de nuevo tu consentimiento.</p>
`;
}

/* ======================================================================================= */

function terms(l, base) {
  const app = esc(l.appName);
  const owner = esc(l.ownerName);
  return `
<h1>Términos y condiciones de uso</h1>
<p class="muted">Última actualización: ${LAST_UPDATED}</p>

<p>Estos términos regulan el uso de <strong>${app}</strong> (la "App"), ofrecida por <strong>${owner}</strong>
(el "Desarrollador"), con domicilio en ${addressText(l)} y correo ${contactLink(l)}. Al crear una cuenta o usar la
App aceptas estos términos y el <a href="${base}/privacidad">Aviso de privacidad</a>. Si no estás de acuerdo, no uses
la App.</p>

<h2>1. El servicio</h2>
<p>${app} reúne herramientas para organizar tu vida diaria: agenda, notas, pendientes, compras, recetas, lugares,
ejercicio, calorías, gastos, presupuestos y apartados. Actualmente la App es <strong>gratuita</strong>, no tiene
publicidad ni compras dentro de la App. Si algún día se cobra por alguna función, te lo informaremos antes y nunca se
cobrará sin tu aceptación expresa.</p>

<h2>2. Tu cuenta</h2>
<ul>
  <li>Debes tener al menos 13 años; si eres menor de 18, necesitas el consentimiento de tu madre, padre o tutor.</li>
  <li>Debes dar información verdadera y cuidar tu contraseña y tu teléfono. Eres responsable de lo que se haga con tu
      cuenta.</li>
  <li>Puedes eliminar tu cuenta cuando quieras desde la App (<em>Perfil → Cuenta y seguridad → Eliminar mi
      cuenta</em>) o desde <a href="${base}/eliminar-cuenta">${base}/eliminar-cuenta</a>.</li>
</ul>

<h2>3. Uso permitido</h2>
<p>Te comprometes a no usar la App para actividades ilegales; no intentar acceder a cuentas o sistemas ajenos;
no sobrecargar, interferir ni hacer ingeniería inversa del servicio; y no usar las funciones de inteligencia
artificial para generar contenido ilícito, dañino o que infrinja derechos de terceros.</p>

<h2>4. Tu contenido</h2>
<p>Lo que registras en la App (notas, eventos, gastos, recetas, fotos, etc.) es tuyo. Nos das únicamente el permiso
necesario para guardarlo, procesarlo y mostrártelo con el fin de prestarte el servicio, como se describe en el Aviso
de privacidad. No lo usamos para otros fines.</p>

<h2>5. Inteligencia artificial</h2>
<p>Algunas funciones generan contenido con inteligencia artificial de un proveedor externo. Ese contenido puede ser
incorrecto, incompleto o no adecuado para tu situación. Revísalo antes de usarlo.</p>

<h2>6. Salud, alimentación y ejercicio</h2>
<p>Las rutinas, los cálculos de calorías y las recomendaciones de la App son <strong>informativos y aproximados</strong>
y <strong>no sustituyen</strong> la opinión de un médico, nutriólogo o entrenador profesional. Consulta a un
profesional de la salud antes de iniciar una dieta o un programa de ejercicio, sobre todo si tienes alguna condición
médica, lesión o estás embarazada. Detente si sientes dolor o malestar.</p>

<h2>7. Finanzas</h2>
<p>Los módulos de gastos, presupuesto y apartados son herramientas de organización personal. La App no es una
institución financiera, no mueve dinero real y sus sugerencias no son asesoría financiera.</p>

<h2>8. Mapas y servicios de terceros</h2>
<p>Los mapas, direcciones, tiendas y rutas provienen de servicios de terceros (OpenStreetMap y la app de mapas de tu
teléfono) y pueden no estar actualizados. Verifica horarios y existencias directamente con cada establecimiento.</p>

<h2>9. Disponibilidad</h2>
<p>Hacemos lo posible para que la App funcione bien y sin interrupciones, pero puede haber fallas, mantenimiento o
cambios. Podemos agregar, modificar o retirar funciones; si retiramos la App por completo, te avisaremos con
anticipación razonable para que puedas consultar tu información.</p>

<h2>10. Responsabilidad</h2>
<p>En la medida en que la ley lo permita, el Desarrollador no será responsable de daños indirectos derivados del uso
de la información generada por la App (incluida la generada por inteligencia artificial), de fallas de servicios de
terceros o de causas de fuerza mayor. Nada en estos términos limita los derechos que te otorgan la Ley Federal de
Protección al Consumidor u otras leyes, ni excluye la responsabilidad por dolo o negligencia grave.</p>

<h2>11. Suspensión</h2>
<p>Podemos suspender o cancelar una cuenta que incumpla gravemente estos términos o que ponga en riesgo la seguridad
del servicio o de otras personas. Cuando sea posible, te avisaremos antes y te explicaremos el motivo.</p>

<h2>12. Tiendas de aplicaciones</h2>
<p>Si descargaste la App desde App Store, también aplica el Contrato de Licencia de Usuario Final estándar de Apple;
Apple no es responsable de la App ni de su soporte. Si la descargaste de Google Play, aplican también los términos de
Google Play.</p>

<h2>13. Cambios a estos términos</h2>
<p>Si cambiamos estos términos publicaremos la nueva versión con su fecha. Si el cambio es importante te avisaremos
en la App antes de que entre en vigor. Si no estás de acuerdo, puedes dejar de usar la App y eliminar tu cuenta.</p>

<h2>14. Ley aplicable</h2>
<p>Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para cualquier controversia, las partes se
someten a los tribunales competentes de ${esc(l.city)}, sin perjuicio de que, como consumidor, puedas acudir a la
Procuraduría Federal del Consumidor (PROFECO) o a los tribunales de tu domicilio.</p>

<h2>15. Contacto</h2>
<p>Dudas, quejas o sugerencias: ${contactLink(l)}.</p>
`;
}

/* ======================================================================================= */

function deletion(l, base, { message = '', error = false, done = false } = {}) {
  const app = esc(l.appName);
  const notice = message ? `<div class="notice ${error ? 'error' : 'ok'}">${esc(message)}</div>` : '';
  const form = done
    ? ''
    : `
<form method="post" action="${base}/eliminar-cuenta" class="card">
  <h3>Eliminar con tu correo y contraseña</h3>
  <label>Correo de tu cuenta<input type="email" name="email" required autocomplete="username" maxlength="255"></label>
  <label>Contraseña<input type="password" name="password" required autocomplete="current-password" maxlength="100"></label>
  <label class="check"><input type="checkbox" name="confirm" value="yes" required> Entiendo que mi cuenta y todos mis datos se borrarán para siempre.</label>
  <button type="submit" class="danger">Eliminar mi cuenta</button>
</form>`;
  return `
<h1>Eliminar tu cuenta de ${app}</h1>
<p class="muted">${app} · Desarrollador: ${esc(l.ownerName)}</p>
${notice}
<p>Puedes eliminar tu cuenta y todos tus datos en cualquier momento, sin costo.</p>

<h2>Desde la App</h2>
<ol>
  <li>Abre ${app} e inicia sesión.</li>
  <li>Ve a <strong>Perfil → Cuenta y seguridad</strong>.</li>
  <li>Toca <strong>Eliminar mi cuenta</strong> y confirma con tu contraseña (o volviendo a entrar con Google o Apple,
      si así creaste tu cuenta).</li>
</ol>

<h2>Desde esta página (sin la App)</h2>
${form}
<p>Si creaste tu cuenta con <strong>Google</strong> o <strong>Apple</strong> y ya no tienes la App, escribe a
${contactLink(l)} <strong>desde el correo de tu cuenta</strong> con el asunto "Eliminar mi cuenta". La eliminaremos en
un máximo de 5 días hábiles y te confirmaremos por correo.</p>

<h2>Qué se borra</h2>
<p>Al eliminar tu cuenta se borran <strong>de inmediato y para siempre</strong>: tu perfil y foto, tu agenda, notas,
pendientes, compras, recetas, lugares, perfil de salud, rutinas, registro de comidas, gastos, presupuestos,
apartados, preferencias y los teléfonos registrados para notificaciones. Si usaste Sign in with Apple, también se
revoca el acceso de ${app} a tu Apple ID.</p>

<h2>Qué se conserva</h2>
<p>Nada de tu cuenta queda activo. Solo las copias de seguridad automáticas de la base de datos pueden contener tus
datos hasta <strong>35 días</strong>, y los registros técnicos del servidor (IP y fecha de las peticiones) hasta
<strong>30 días</strong>; después se eliminan solos. No se usan para ningún otro fin.</p>
<p>Más información en el <a href="${base}/privacidad">Aviso de privacidad</a>.</p>
`;
}

/* ======================================================================================= */

function support(l, base) {
  const app = esc(l.appName);
  return `
<h1>Soporte de ${app}</h1>
<p>¿Tienes un problema, una duda o una sugerencia? Escríbenos a ${contactLink(l)}. Respondemos normalmente en 2 a 3
días hábiles.</p>

<h2>Preguntas frecuentes</h2>
<h3>Olvidé mi contraseña</h3>
<p>Escríbenos desde el correo de tu cuenta y te ayudamos a recuperar el acceso. Si entras con Google o Apple, usa ese
mismo botón para entrar.</p>
<h3>El mapa no muestra mi ubicación</h3>
<p>Revisa que la ubicación del teléfono esté activa y que ${app} tenga permiso (Ajustes del teléfono → ${app} →
Ubicación). Luego toca el botón <em>Mi ubicación</em> del mapa.</p>
<h3>No me llegan las notificaciones</h3>
<p>Revisa que estén permitidas en los ajustes del teléfono y en <em>Perfil → Notificaciones</em>.</p>
<h3>¿Cómo entro con Face ID o huella?</h3>
<p>Después de iniciar sesión con tu correo, la App te ofrece guardar tu acceso en el teléfono. Puedes activarlo o
desactivarlo en <em>Perfil → Cuenta y seguridad</em>.</p>
<h3>¿Cómo elimino mi cuenta?</h3>
<p>Sigue los pasos de <a href="${base}/eliminar-cuenta">esta página</a>.</p>
<h3>¿Qué hacen con mis datos?</h3>
<p>Lee el <a href="${base}/privacidad">Aviso de privacidad</a>. Para ejercer tus derechos ARCO escribe al correo de
arriba.</p>
`;
}

module.exports = { privacy, terms, deletion, support, esc, LAST_UPDATED };
