/** Recetario con IA: genera recetas (Groq u otro proveedor) y permite guardarlas. */
const { query } = require('../config/db');
const { HttpError, asyncHandler } = require('../utils/http');
const { validate } = require('../utils/validator');
const { parseId } = require('./crud.controller');
const { generateRecipe } = require('../services/ai.service');
const schemas = require('../validators/schemas');

const fromRow = (row) => ({
  id: row.Id,
  title: row.Title,
  prompt: row.Prompt,
  createdAt: row.CreatedAt,
  ...JSON.parse(row.Content),
});

async function saveRecipe(userId, prompt, recipe) {
  const result = await query(
    `INSERT INTO dbo.Recipes (UserId, Title, Prompt, Content)
     OUTPUT INSERTED.* VALUES (@userId, @title, @prompt, @content)`,
    { userId, title: recipe.title, prompt, content: JSON.stringify(recipe) },
  );
  return fromRow(result.recordset[0]);
}

// POST /api/recipes/generate { prompt, servings?, save? }
const generate = asyncHandler(async (req, res) => {
  const { prompt, servings, save } = validate(schemas.recipeRequest, req.body);
  const recipe = await generateRecipe({ prompt, servings });
  if (save) return res.status(201).json(await saveRecipe(req.user.id, prompt, recipe));
  return res.json(recipe);
});

// POST /api/recipes  (guardar una receta ya generada)
const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.title || !Array.isArray(body.ingredients) || !Array.isArray(body.steps)) {
    throw new HttpError(400, 'La receta debe incluir title, ingredients y steps');
  }
  const { prompt = null, id: _id, createdAt: _c, ...recipe } = body;
  res.status(201).json(await saveRecipe(req.user.id, prompt, recipe));
});

const list = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT * FROM dbo.Recipes WHERE UserId = @userId ORDER BY CreatedAt DESC',
    { userId: req.user.id },
  );
  res.json(result.recordset.map(fromRow));
});

const getOne = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT * FROM dbo.Recipes WHERE Id = @id AND UserId = @userId',
    { id: parseId(req), userId: req.user.id },
  );
  if (!result.recordset[0]) throw new HttpError(404, 'Receta no encontrada');
  res.json(fromRow(result.recordset[0]));
});

const remove = asyncHandler(async (req, res) => {
  const result = await query(
    'DELETE FROM dbo.Recipes OUTPUT DELETED.Id WHERE Id = @id AND UserId = @userId',
    { id: parseId(req), userId: req.user.id },
  );
  if (!result.recordset[0]) throw new HttpError(404, 'Receta no encontrada');
  res.status(204).end();
});

module.exports = { generate, create, list, getOne, remove };
