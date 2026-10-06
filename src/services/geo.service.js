/**
 * Servicios de mapas con datos abiertos de OpenStreetMap (gratis, sin clave):
 *  - Nominatim: buscar direcciones y obtener la dirección de unas coordenadas.
 *  - Overpass: encontrar tiendas cercanas por tipo.
 *
 * Políticas de uso: Nominatim pide máximo 1 petición por segundo y un User-Agent que
 * identifique la app; por eso las llamadas pasan por el backend, con caché y pausa.
 */
const { env } = require('../config/env');
const { HttpError } = require('../utils/http');

/** Tipos de tienda que entiende la app y sus etiquetas en OpenStreetMap. */
const STORE_TYPES = {
  supermarket: { label: 'Súper', tags: [['shop', 'supermarket']] },
  convenience: { label: 'Tienda de conveniencia', tags: [['shop', 'convenience']] },
  pharmacy: { label: 'Farmacia', tags: [['amenity', 'pharmacy'], ['shop', 'chemist']] },
  hardware: { label: 'Ferretería', tags: [['shop', 'hardware'], ['shop', 'doityourself']] },
  bakery: { label: 'Panadería', tags: [['shop', 'bakery']] },
  butcher: { label: 'Carnicería', tags: [['shop', 'butcher']] },
  greengrocer: { label: 'Frutas y verduras', tags: [['shop', 'greengrocer']] },
  stationery: { label: 'Papelería', tags: [['shop', 'stationery']] },
  pet: { label: 'Mascotas', tags: [['shop', 'pet']] },
  electronics: { label: 'Electrónica', tags: [['shop', 'electronics'], ['shop', 'mobile_phone']] },
  clothes: { label: 'Ropa y calzado', tags: [['shop', 'clothes'], ['shop', 'shoes']] },
  department_store: { label: 'Tienda departamental', tags: [['shop', 'department_store'], ['shop', 'mall']] },
};

/* ---------------- utilidades ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Caché sencilla en memoria con caducidad. */
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

/** Garantiza al menos 1.1 s entre llamadas a Nominatim. */
let lastNominatim = 0;
let queue = Promise.resolve();
function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastNominatim = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

function userAgent() {
  return `multiApp/1.0 (${env.geo.contactEmail || 'app educativa'})`;
}

async function fetchJson(url, init, fetchImpl, errorMessage) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(25000) });
  } catch (err) {
    console.error('Error de red (mapas):', err.message);
    throw new HttpError(502, errorMessage);
  }
  if (!res.ok) {
    console.error(`Mapas respondió ${res.status} para ${url.split('?')[0]}`);
    throw new HttpError(res.status === 429 ? 429 : 502, res.status === 429 ? 'Demasiadas búsquedas seguidas, espera un momento' : errorMessage);
  }
  return res.json();
}

/* ---------------- direcciones (Nominatim) ---------------- */

function formatNominatim(r) {
  return {
    name: r.name || r.display_name.split(',')[0],
    address: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
  };
}

/** Busca direcciones o lugares por texto. Si se envían lat/lon, prioriza resultados cercanos. */
async function searchAddress(q, { lat, lon } = {}, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '0',
    limit: '6',
    'accept-language': 'es',
  });
  if (env.geo.countryCodes) params.set('countrycodes', env.geo.countryCodes);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    params.set('viewbox', `${lon - 0.3},${lat + 0.3},${lon + 0.3},${lat - 0.3}`);
  }
  const url = `${env.geo.nominatimUrl}/search?${params}`;
  return cached(url, async () => {
    const data = await throttled(() =>
      fetchJson(url, { headers: { 'User-Agent': userAgent() } }, fetchImpl, 'No se pudo buscar la dirección'),
    );
    return data.map(formatNominatim);
  });
}

/** Dirección aproximada de unas coordenadas. */
async function reverseGeocode(lat, lon, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    'accept-language': 'es',
    zoom: '18',
  });
  const url = `${env.geo.nominatimUrl}/reverse?${params}`;
  return cached(url, async () => {
    const data = await throttled(() =>
      fetchJson(url, { headers: { 'User-Agent': userAgent() } }, fetchImpl, 'No se pudo obtener la dirección'),
    );
    if (!data || data.error) return { name: 'Ubicación', address: `${lat}, ${lon}`, lat, lon };
    return formatNominatim(data);
  });
}

/* ---------------- tiendas cercanas (Overpass) ---------------- */

function buildOverpassQuery(types, lat, lon, radius) {
  const lines = [];
  for (const type of types) {
    for (const [k, v] of STORE_TYPES[type].tags) {
      lines.push(`  nwr["${k}"="${v}"](around:${radius},${lat},${lon});`);
    }
  }
  return `[out:json][timeout:25];\n(\n${lines.join('\n')}\n);\nout center tags 200;`;
}

/** Decide a qué tipo de la app pertenece un elemento de OSM. */
function typeOf(tags, types) {
  return types.find((t) => STORE_TYPES[t].tags.some(([k, v]) => tags[k] === v));
}

function parseOverpass(data, types, lat, lon, perType) {
  const byType = Object.fromEntries(types.map((t) => [t, []]));
  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const pLat = el.lat ?? el.center?.lat;
    const pLon = el.lon ?? el.center?.lon;
    const type = typeOf(tags, types);
    if (!type || !Number.isFinite(pLat) || !Number.isFinite(pLon)) continue;
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
    byType[type].push({
      id: `${el.type}/${el.id}`,
      name: tags.name || tags.brand || STORE_TYPES[type].label,
      type,
      label: STORE_TYPES[type].label,
      address: street || tags['addr:full'] || null,
      openingHours: tags.opening_hours || null,
      lat: pLat,
      lon: pLon,
      distance: distanceMeters(lat, lon, pLat, pLon),
    });
  }
  for (const t of types) {
    byType[t].sort((a, b) => a.distance - b.distance);
    byType[t] = byType[t].slice(0, perType);
  }
  return byType;
}

/**
 * Tiendas cercanas agrupadas por tipo, ordenadas por distancia.
 * Si en el radio no hay nada de algún tipo, se reintenta una vez con el triple de radio.
 */
async function nearbyStores({ lat, lon, types, radius = 2500, perType = 5 }, { fetchImpl = fetch } = {}) {
  const valid = [...new Set(types)].filter((t) => STORE_TYPES[t]);
  if (valid.length === 0) return {};
  // Redondear a ~100 m para aprovechar la caché entre búsquedas cercanas.
  const rLat = Number(lat.toFixed(3));
  const rLon = Number(lon.toFixed(3));

  const query = async (r) =>
    cached(`overpass:${rLat},${rLon}:${r}:${valid.sort().join(',')}`, () =>
      fetchJson(
        env.geo.overpassUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent() },
          body: `data=${encodeURIComponent(buildOverpassQuery(valid, rLat, rLon, r))}`,
        },
        fetchImpl,
        'No se pudieron consultar las tiendas cercanas',
      ),
    );

  let result = parseOverpass(await query(radius), valid, lat, lon, perType);
  const missing = valid.filter((t) => result[t].length === 0);
  if (missing.length > 0 && radius < 8000) {
    const wider = parseOverpass(await query(radius * 3), valid, lat, lon, perType);
    for (const t of missing) result[t] = wider[t];
  }
  return result;
}

module.exports = {
  STORE_TYPES,
  distanceMeters,
  searchAddress,
  reverseGeocode,
  nearbyStores,
  buildOverpassQuery,
  parseOverpass,
};
