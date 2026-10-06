/**
 * Verifica la configuración de la IA:  npm run ai:check
 *  1. Muestra el proveedor y modelo configurados.
 *  2. Lista los modelos disponibles con tu clave.
 *  3. Genera una receta de prueba.
 */
const { env } = require('../src/config/env');
const { generateRecipe } = require('../src/services/ai.service');

async function main() {
  console.log('Proveedor :', env.ai.baseUrl);
  console.log('Modelo    :', env.ai.model);
  console.log('Clave     :', env.ai.apiKey ? `${env.ai.apiKey.slice(0, 6)}… (${env.ai.apiKey.length} caracteres)` : '✖ FALTA AI_API_KEY');
  if (!env.ai.apiKey) process.exit(1);

  console.log('\n▶ Modelos disponibles con tu clave:');
  const res = await fetch(`${env.ai.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${env.ai.apiKey}` },
  });
  if (!res.ok) {
    console.error(`✖ No se pudo listar modelos (${res.status}):`, (await res.text()).slice(0, 300));
    process.exit(1);
  }
  const { data = [] } = await res.json();
  const ids = data.map((m) => String(m.id).replace(/^models\//, ''));
  const chatModels = ids.filter((id) => /flash|pro|gpt|llama|mistral|gemma/i.test(id) && !/embed|image|tts|veo|audio/i.test(id));
  console.log((chatModels.length ? chatModels : ids).map((id) => `  - ${id}`).join('\n'));
  if (!ids.includes(env.ai.model)) {
    console.warn(`\n⚠ El modelo "${env.ai.model}" no aparece en la lista. Cambia AI_MODEL por uno de los anteriores.`);
  }

  if (!ids.includes(env.ai.visionModel)) {
    const vision = ids.filter((id) => /vision|qwen3|llama-4|scout|maverick|gemma-3/i.test(id));
    console.warn(`⚠ El modelo de visión "${env.ai.visionModel}" no aparece. Candidatos: ${vision.join(', ') || '(ninguno)'}`);
    console.warn('  Cámbialo en AI_VISION_MODEL para calcular calorías con foto.');
  } else {
    console.log(`✔ Modelo de visión disponible: ${env.ai.visionModel}`);
  }

  console.log('\n▶ Generando receta de prueba…');
  const recipe = await generateRecipe({ prompt: 'Quesadillas sencillas', servings: 2 });
  console.log(`✔ "${recipe.title}" — ${recipe.ingredients.length} ingredientes, ${recipe.steps.length} pasos`);
  console.log('\nTodo listo: el recetario funciona.');
}

main().catch((err) => {
  console.error('✖', err.message);
  process.exit(1);
});
