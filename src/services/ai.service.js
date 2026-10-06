/**
 * Cliente de IA (recetario, rutinas, calorías y clasificación de compras).
 *
 * Usa el formato "Chat Completions" de OpenAI, que también aceptan Gemini, Groq,
 * OpenRouter y Ollama. Para cambiar de proveedor solo se editan en el .env:
 *   AI_BASE_URL, AI_API_KEY y AI_MODEL
 * Por defecto apunta a Groq (nivel gratuito, sin tarjeta).
 */
const { env } = require('../config/env');
const { HttpError } = require('../utils/http');

const SYSTEM_PROMPT = `Eres un chef que ayuda a cocinar en casa. Responde SIEMPRE en español
y SOLO con un objeto JSON válido (sin texto extra ni bloques de código) con esta forma exacta:
{
  "title": string,
  "description": string,
  "servings": number,
  "prepMinutes": number,
  "cookMinutes": number,
  "difficulty": "fácil" | "media" | "difícil",
  "ingredients": [{ "name": string, "quantity": string }],
  "steps": [string],
  "tips": [string],
  "nutritionPerServing": { "calories": number, "protein": number, "carbs": number, "fat": number }
}
"nutritionPerServing" es una estimación realista por porción (kcal y gramos).
Si lo que pide el usuario no es comida o una receta, devuelve el mismo formato con
"title": "Sin receta" y explica en "description" qué puede pedir.`;

function normalizeRecipe(raw) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    title: String(raw.title || 'Receta').slice(0, 200),
    description: String(raw.description || ''),
    servings: num(raw.servings, 2),
    prepMinutes: num(raw.prepMinutes, 0),
    cookMinutes: num(raw.cookMinutes, 0),
    difficulty: String(raw.difficulty || 'media'),
    ingredients: arr(raw.ingredients).map((i) =>
      typeof i === 'string' ? { name: i, quantity: '' } : { name: String(i.name || ''), quantity: String(i.quantity || '') },
    ),
    steps: arr(raw.steps).map(String),
    tips: arr(raw.tips).map(String),
    nutritionPerServing: normalizeNutrition(raw.nutritionPerServing),
  };
}

/** Normaliza { calories, protein, carbs, fat } (o null si no viene). */
function normalizeNutrition(n) {
  if (!n || typeof n !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 10) / 10 : 0);
  const calories = Math.round(num(n.calories));
  if (!calories) return null;
  return { calories, protein: num(n.protein), carbs: num(n.carbs), fat: num(n.fat) };
}

/** Extrae el JSON aunque el modelo lo envuelva en ```json ... ``` o agregue texto. */
function extractJson(text) {
  if (typeof text !== 'string') throw new Error('Respuesta vacía');
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No se encontró JSON');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

/** Traduce los errores del proveedor a mensajes útiles para el usuario y para ti. */
function providerError(status, body) {
  console.error(`IA (${env.ai.baseUrl}) respondió ${status}:`, body.slice(0, 500));
  if (status === 429) {
    return new HttpError(429, 'Se alcanzó el límite gratuito de la IA. Intenta de nuevo en un minuto.');
  }
  if (status === 401 || status === 403) {
    return new HttpError(503, 'La clave de la IA no es válida. Revisa AI_API_KEY en el .env');
  }
  if (status === 404) {
    return new HttpError(503, `El modelo "${env.ai.model}" no existe. Revisa AI_MODEL en el .env (npm run ai:check)`);
  }
  return new HttpError(502, 'No se pudo generar la receta en este momento');
}

async function chat(messages, { json = true, fetchImpl = fetch, model = env.ai.model, temperature = 0.7 } = {}) {
  const body = { model, temperature, messages };
  if (json) body.response_format = { type: 'json_object' };

  const response = await fetchImpl(`${env.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.ai.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    // Algunos proveedores/modelos no aceptan response_format: se reintenta sin él.
    if (json && response.status === 400 && /response_format|json/i.test(text)) {
      return chat(messages, { json: false, fetchImpl, model, temperature });
    }
    throw providerError(response.status, text);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content;
}

/**
 * Envía un prompt de sistema + mensaje de usuario y devuelve el JSON que responda el modelo.
 * `user` puede ser texto o una lista de partes (texto + imagen) para modelos con visión.
 * Lanza HttpError con mensajes claros si no hay clave, se agota el tiempo o la respuesta no es JSON.
 */
async function chatJson(system, user, { fetchImpl = fetch, model, temperature } = {}) {
  if (!env.ai.apiKey) {
    throw new HttpError(503, 'La IA no está configurada (falta AI_API_KEY en el .env)');
  }

  let content;
  try {
    content = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { fetchImpl, ...(model ? { model } : {}), ...(temperature !== undefined ? { temperature } : {}) },
    );
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.name === 'TimeoutError') throw new HttpError(504, 'La IA tardó demasiado en responder');
    console.error('Error llamando a la IA:', err);
    throw new HttpError(502, 'No se pudo conectar con el servicio de IA');
  }

  try {
    return extractJson(content);
  } catch {
    throw new HttpError(502, 'La IA devolvió una respuesta que no se pudo leer. Intenta de nuevo.');
  }
}

async function generateRecipe({ prompt, servings }, { fetchImpl = fetch } = {}) {
  const userMessage = servings ? `${prompt}\nPorciones: ${servings}` : prompt;
  return normalizeRecipe(await chatJson(SYSTEM_PROMPT, userMessage, { fetchImpl }));
}

module.exports = { generateRecipe, normalizeRecipe, normalizeNutrition, extractJson, chatJson };
