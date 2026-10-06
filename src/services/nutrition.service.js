/**
 * Estimación de calorías y macronutrientes con IA, a partir de una descripción o una foto.
 * Son aproximaciones: la app lo indica al usuario.
 */
const { env } = require('../config/env');
const { chatJson } = require('./ai.service');

const SHAPE = `{
  "description": string,          // resumen corto de lo que se comió
  "items": [{ "name": string, "quantity": string, "calories": number, "protein": number, "carbs": number, "fat": number }],
  "confidence": "alta" | "media" | "baja",
  "notes": string                 // supuestos que hiciste (tamaño de porción, aceite, etc.)
}`;

const TEXT_PROMPT = `Eres nutriólogo. Estima calorías (kcal) y macronutrientes (gramos) de lo que
el usuario comió, con porciones típicas de México si no se especifican. Responde SOLO con JSON:
${SHAPE}`;

const PHOTO_PROMPT = `Eres nutriólogo. Mira la foto del platillo, identifica los alimentos y estima
porciones, calorías (kcal) y macronutrientes (gramos). Si no hay comida en la imagen, devuelve
"items": [] y explica en "notes". Responde SOLO con JSON:
${SHAPE}`;

const round1 = (v) => Math.round(Math.max(0, Number(v) || 0) * 10) / 10;

function normalizeEstimate(raw) {
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 20).map((i) => ({
    name: String(i.name || 'Alimento'),
    quantity: String(i.quantity || ''),
    calories: Math.round(Math.max(0, Number(i.calories) || 0)),
    protein: round1(i.protein),
    carbs: round1(i.carbs),
    fat: round1(i.fat),
  }));
  const sum = (k) => items.reduce((s, i) => s + i[k], 0);
  return {
    description: String(raw.description || items.map((i) => i.name).join(', ') || '').slice(0, 300),
    items,
    total: { calories: Math.round(sum('calories')), protein: round1(sum('protein')), carbs: round1(sum('carbs')), fat: round1(sum('fat')) },
    confidence: ['alta', 'media', 'baja'].includes(raw.confidence) ? raw.confidence : 'media',
    notes: String(raw.notes || ''),
  };
}

async function estimateFromText(text, { fetchImpl } = {}) {
  const raw = await chatJson(TEXT_PROMPT, text, { temperature: 0.2, ...(fetchImpl ? { fetchImpl } : {}) });
  return normalizeEstimate(raw);
}

/** dataUri: "data:image/jpeg;base64,..." */
async function estimateFromPhoto(dataUri, note, { fetchImpl } = {}) {
  const content = [
    { type: 'text', text: note ? `Comentario del usuario: ${note}` : 'Estima lo que hay en este platillo.' },
    { type: 'image_url', image_url: { url: dataUri } },
  ];
  const raw = await chatJson(PHOTO_PROMPT, content, {
    model: env.ai.visionModel,
    temperature: 0.2,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  return normalizeEstimate(raw);
}

module.exports = { estimateFromText, estimateFromPhoto, normalizeEstimate };
