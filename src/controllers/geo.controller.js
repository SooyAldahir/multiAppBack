/** Mapas: buscar direcciones, tiendas cercanas y "¿dónde compro?" para la lista de compras. */
const { query } = require('../config/db');
const { HttpError, asyncHandler, toCamel } = require('../utils/http');
const geo = require('../services/geo.service');
const { classifyItems } = require('../services/where-to-buy.service');

/** Lee lat/lon de un objeto (query o body). Si `required` es false y faltan, devuelve null. */
function readCoords(src, { required = true } = {}) {
  const hasLat = src.lat !== undefined && src.lat !== null && src.lat !== '';
  const hasLon = src.lon !== undefined && src.lon !== null && src.lon !== '';
  if (!hasLat && !hasLon && !required) return null;
  const lat = Number(src.lat);
  const lon = Number(src.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new HttpError(400, 'Coordenadas inválidas (lat, lon)');
  }
  return { lat, lon };
}

// GET /api/geo/search?q=texto&lat=&lon=
const search = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) throw new HttpError(400, 'Escribe al menos 3 letras para buscar');
  const near = readCoords(req.query, { required: false }) || {};
  res.json(await geo.searchAddress(q.slice(0, 200), near));
});

// GET /api/geo/reverse?lat=&lon=
const reverse = asyncHandler(async (req, res) => {
  const { lat, lon } = readCoords(req.query);
  res.json(await geo.reverseGeocode(lat, lon));
});

// GET /api/geo/nearby?lat=&lon=&types=supermarket,pharmacy&radius=2500
const nearby = asyncHandler(async (req, res) => {
  const { lat, lon } = readCoords(req.query);
  const types = String(req.query.types || 'supermarket').split(',').map((t) => t.trim());
  const radius = Math.min(Math.max(Number(req.query.radius) || 2500, 300), 10000);
  res.json(await geo.nearbyStores({ lat, lon, types, radius }));
});

// GET /api/geo/store-types
const storeTypes = (_req, res) => {
  res.json(Object.entries(geo.STORE_TYPES).map(([type, t]) => ({ type, label: t.label })));
};

// POST /api/shopping/where-to-buy { lat?, lon? }
// Agrupa lo pendiente de la lista por tipo de tienda y, si hay ubicación, agrega las tiendas más cercanas.
const whereToBuy = asyncHandler(async (req, res) => {
  const coords = readCoords(req.body || {}, { required: false });
  const result = await query(
    'SELECT Id, Name, Quantity FROM dbo.ShoppingItems WHERE UserId = @userId AND IsChecked = 0 ORDER BY CreatedAt',
    { userId: req.user.id },
  );
  const items = result.recordset.map(toCamel);
  if (items.length === 0) return res.json({ aiUsed: false, groups: [] });

  const { aiUsed, groups } = await classifyItems(items);

  let storesError = null;
  if (coords) {
    try {
      const stores = await geo.nearbyStores({ ...coords, types: groups.map((g) => g.type) });
      for (const g of groups) g.stores = stores[g.type] || [];
    } catch (err) {
      storesError = err.message;
      for (const g of groups) g.stores = [];
    }
  }

  res.json({ aiUsed, groups, storesError });
});

module.exports = { search, reverse, nearby, storeTypes, whereToBuy, readCoords };
