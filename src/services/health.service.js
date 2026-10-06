/** Cálculo de metas diarias a partir del perfil de salud. */

const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

/**
 * Metas con la fórmula de Mifflin-St Jeor:
 *  - BMR (metabolismo basal), TDEE (gasto diario según actividad)
 *  - meta de calorías según objetivo (bajar −500, subir +300)
 *  - macros: proteína por kg de peso, 25 % de grasa y el resto carbohidratos
 */
function computeTargets(p, now = new Date()) {
  if (!p || !p.weightKg || !p.heightCm || !p.birthYear) return null;
  const age = Math.max(14, now.getFullYear() - p.birthYear);
  const weight = Number(p.weightKg);
  const height = Number(p.heightCm);
  const bmr = 10 * weight + 6.25 * height - 5 * age + (p.sex === 'female' ? -161 : 5);
  const tdee = bmr * (ACTIVITY[p.activityLevel] || ACTIVITY.light);

  let calories = tdee;
  if (p.goal === 'lose') calories = Math.max(tdee - 500, p.sex === 'female' ? 1200 : 1500);
  if (p.goal === 'gain') calories = tdee + 300;
  calories = Math.round(calories / 10) * 10;

  const proteinPerKg = p.goal === 'lose' ? 2.0 : p.goal === 'gain' ? 1.8 : 1.6;
  const protein = Math.round(weight * proteinPerKg);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const bmi = Math.round((weight / (height / 100) ** 2) * 10) / 10;

  return { age, bmr: Math.round(bmr), tdee: Math.round(tdee), calories, protein, carbs, fat, bmi };
}

/** Calorías aproximadas de un entrenamiento (MET ≈ 5 para pesas/circuito moderado). */
function estimateBurn(minutes, weightKg = 70, met = 5) {
  return Math.round(met * Number(weightKg || 70) * (Number(minutes) / 60));
}

module.exports = { computeTargets, estimateBurn };
