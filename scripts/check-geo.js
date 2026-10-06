/**
 * Verifica que el backend pueda usar los mapas de OpenStreetMap:  npm run geo:check
 * Opcional: npm run geo:check -- "Tu ciudad o dirección"
 */
const geo = require('../src/services/geo.service');

async function main() {
  const q = process.argv[2] || 'Zócalo, Ciudad de México';
  console.log(`▶ Buscando "${q}"…`);
  const results = await geo.searchAddress(q);
  if (results.length === 0) {
    console.log('✖ Sin resultados. Prueba con otra dirección.');
    process.exit(1);
  }
  const first = results[0];
  console.log(`✔ ${first.address}\n  (${first.lat}, ${first.lon})`);

  console.log('\n▶ Dirección de esas coordenadas…');
  const rev = await geo.reverseGeocode(first.lat, first.lon);
  console.log(`✔ ${rev.address}`);

  console.log('\n▶ Súper y farmacias cercanas…');
  const stores = await geo.nearbyStores({ lat: first.lat, lon: first.lon, types: ['supermarket', 'pharmacy'], perType: 3 });
  for (const [type, list] of Object.entries(stores)) {
    console.log(`  ${geo.STORE_TYPES[type].label}:`);
    for (const s of list) console.log(`   - ${s.name} (${s.distance} m)`);
    if (list.length === 0) console.log('   (ninguna en el radio)');
  }
  console.log('\nTodo listo: los mapas funcionan.');
}

main().catch((err) => {
  console.error('✖', err.message);
  process.exit(1);
});
