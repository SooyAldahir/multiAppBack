/**
 * Clasifica los artículos de la lista de compras por tipo de tienda
 * (leche → súper, paracetamol → farmacia, tornillos → ferretería…).
 * Usa la IA y, si no está disponible, unas reglas simples por palabras clave.
 */
const { chatJson } = require('./ai.service');
const { STORE_TYPES } = require('./geo.service');

const TYPE_LIST = Object.entries(STORE_TYPES)
  .map(([key, t]) => `- ${key}: ${t.label}`)
  .join('\n');

const SYSTEM_PROMPT = `Eres un asistente de compras en México. Para cada artículo de la lista decide
en qué tipo de tienda conviene comprarlo. Tipos permitidos (usa SOLO la clave):
${TYPE_LIST}

Reglas:
- Si se puede comprar en el súper (comida, limpieza, higiene básica), usa "supermarket".
- Medicinas → "pharmacy". Herramientas, tornillería, pintura, focos → "hardware".
- Responde SOLO con JSON: {"items":[{"i":1,"type":"supermarket"}, ...]} incluyendo todos los números.`;

/** Reglas de respaldo cuando la IA no está disponible. */
const KEYWORDS = [
  ['pharmacy', /medic|pastill|tableta|paracetamol|ibuprofeno|aspirina|jarabe|vitamina|curita|gasa|antibi|pomada|suero oral|termómetro/i],
  ['hardware', /tornillo|clavo|taquete|foco|bombilla|pintura|brocha|cinta de aislar|pegamento|martillo|desarmador|llave inglesa|cable|enchufe|tubo pvc|silic/i],
  ['stationery', /cuaderno|libreta|pluma|bol[ií]grafo|l[aá]piz|hojas|folder|cartulina|marcador|resistol|tijeras|engrapadora/i],
  ['pet', /croqueta|arena para gato|alimento para (perro|gato)|correa/i],
  ['bakery', /bolillo|concha|pan dulce|pastel|telera/i],
  ['electronics', /cargador|aud[ií]fono|bater[ií]a|memoria usb|cable usb/i],
];

function classifyByKeywords(name) {
  const hit = KEYWORDS.find(([, re]) => re.test(name));
  return hit ? hit[0] : 'supermarket';
}

/**
 * items: [{ id, name, quantity }]
 * Devuelve { aiUsed, groups: [{ type, label, items }] } ordenado por cantidad de artículos.
 */
async function classifyItems(items, { fetchImpl } = {}) {
  let types = items.map((i) => classifyByKeywords(i.name));
  let aiUsed = false;

  try {
    const list = items.map((item, idx) => `${idx + 1}. ${item.name}`).join('\n');
    const json = await chatJson(SYSTEM_PROMPT, list, fetchImpl ? { fetchImpl } : {});
    const answers = Array.isArray(json.items) ? json.items : [];
    const fromAi = [...types];
    for (const a of answers) {
      const idx = Number(a.i) - 1;
      if (idx >= 0 && idx < items.length && STORE_TYPES[a.type]) fromAi[idx] = a.type;
    }
    types = fromAi;
    aiUsed = true;
  } catch (err) {
    console.warn('Clasificación sin IA (se usan palabras clave):', err.message);
  }

  const groups = new Map();
  items.forEach((item, idx) => {
    const type = types[idx];
    if (!groups.has(type)) groups.set(type, { type, label: STORE_TYPES[type].label, items: [] });
    groups.get(type).items.push(item);
  });

  return {
    aiUsed,
    groups: [...groups.values()].sort((a, b) => b.items.length - a.items.length),
  };
}

module.exports = { classifyItems, classifyByKeywords };
