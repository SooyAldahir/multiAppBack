/**
 * Rutinas de ejercicio generadas con IA, según el perfil y lo entrenado en los últimos días.
 * Cada ejercicio trae un enlace de búsqueda en YouTube (siempre funciona, a diferencia de
 * links directos que la IA podría inventar).
 */
const { chatJson } = require('./ai.service');
const { estimateBurn } = require('./health.service');

const LABELS = {
  goal: { lose: 'bajar de peso', maintain: 'mantenerse en forma', gain: 'ganar músculo' },
  level: { beginner: 'principiante', intermediate: 'intermedio', advanced: 'avanzado' },
  equipment: { none: 'en casa sin equipo (peso corporal)', dumbbells: 'en casa con mancuernas', gym: 'en gimnasio con máquinas y pesas' },
};

const FOCUS_OPTIONS = ['pecho', 'espalda', 'piernas', 'glúteos', 'hombros', 'brazos', 'core', 'cuerpo completo', 'cardio', 'movilidad'];

const SYSTEM_PROMPT = `Eres un entrenador personal certificado. Diseñas rutinas seguras y efectivas.
Responde SIEMPRE en español y SOLO con JSON válido con esta forma:
{
  "title": string,                 // ej. "Pecho y tríceps"
  "focus": string,                 // grupos musculares principales
  "reason": string,                // por qué conviene entrenar esto hoy (1-2 frases)
  "durationMinutes": number,
  "estimatedCalories": number,
  "warmup": [string],              // 2-4 pasos de calentamiento
  "exercises": [{
    "name": string,
    "muscles": [string],
    "sets": number,
    "reps": string,                // ej. "10-12" o "30 s"
    "restSeconds": number,
    "instructions": [string],      // 3-5 pasos claros de cómo hacerlo
    "commonMistakes": [string],    // 1-3 errores comunes
    "easierVariant": string,       // opción más fácil
    "youtubeQuery": string         // búsqueda en YouTube para ver la técnica, en español
  }],
  "cooldown": [string],
  "tips": [string]
}
Reglas: ajusta volumen e intensidad al nivel; respeta el equipo disponible; evita los ejercicios
que afecten las lesiones o limitaciones indicadas; no repitas el mismo grupo muscular grande que
se trabajó ayer; entre 4 y 8 ejercicios.`;

function youtubeUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function normalizeWorkout(raw, { minutes, weightKg }) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : d);
  const duration = num(raw.durationMinutes, minutes);
  const exercises = arr(raw.exercises)
    .slice(0, 10)
    .map((e) => {
      const name = String(e.name || 'Ejercicio');
      const query = String(e.youtubeQuery || `${name} técnica correcta`);
      return {
        name,
        muscles: arr(e.muscles).map(String),
        sets: Math.min(num(e.sets, 3), 10),
        reps: String(e.reps || '10-12'),
        restSeconds: Math.min(num(e.restSeconds, 60), 300),
        instructions: arr(e.instructions).map(String),
        commonMistakes: arr(e.commonMistakes).map(String),
        easierVariant: e.easierVariant ? String(e.easierVariant) : null,
        youtubeQuery: query,
        youtubeUrl: youtubeUrl(query),
      };
    });
  return {
    title: String(raw.title || 'Rutina de hoy').slice(0, 150),
    focus: String(raw.focus || ''),
    reason: String(raw.reason || ''),
    durationMinutes: duration,
    estimatedCalories: num(raw.estimatedCalories, estimateBurn(duration, weightKg)),
    warmup: arr(raw.warmup).map(String),
    exercises,
    cooldown: arr(raw.cooldown).map(String),
    tips: arr(raw.tips).map(String),
  };
}

/** Construye el mensaje para la IA con el perfil, el historial reciente y lo que pide el usuario. */
function buildUserMessage({ profile, history, focus, minutes, notes, today = new Date() }) {
  const p = profile || {};
  const lines = [
    `Objetivo: ${LABELS.goal[p.goal] || 'mantenerse en forma'}`,
    `Nivel: ${LABELS.level[p.fitnessLevel] || 'principiante'}`,
    `Equipo: ${LABELS.equipment[p.equipment] || LABELS.equipment.none}`,
    `Duración deseada: ${minutes} minutos`,
  ];
  if (p.sex) lines.push(`Sexo: ${p.sex === 'female' ? 'mujer' : 'hombre'}`);
  if (p.birthYear) lines.push(`Edad: ${today.getFullYear() - p.birthYear} años`);
  if (p.weightKg) lines.push(`Peso: ${p.weightKg} kg`);
  if (p.limitations) lines.push(`Lesiones o limitaciones: ${p.limitations}`);
  if (focus) lines.push(`El usuario quiere entrenar hoy: ${focus}`);
  else lines.push('El usuario no eligió enfoque: decide tú qué conviene entrenar hoy según el historial.');
  if (notes) lines.push(`Comentario del usuario: ${notes}`);

  if (history.length === 0) {
    lines.push('Historial: no hay entrenamientos en los últimos 7 días.');
  } else {
    lines.push('Historial de los últimos 7 días:');
    for (const h of history) {
      const days = Math.round((today - new Date(h.performedAt)) / 86400000);
      const when = days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`;
      lines.push(`- ${when}: ${h.title}${h.focus ? ` (${h.focus})` : ''}`);
    }
  }
  return lines.join('\n');
}

async function generateWorkout({ profile, history = [], focus, minutes = 45, notes }, { fetchImpl } = {}) {
  const user = buildUserMessage({ profile, history, focus, minutes, notes });
  const raw = await chatJson(SYSTEM_PROMPT, user, fetchImpl ? { fetchImpl } : {});
  return normalizeWorkout(raw, { minutes, weightKg: profile?.weightKg });
}

module.exports = { generateWorkout, normalizeWorkout, buildUserMessage, youtubeUrl, FOCUS_OPTIONS };
