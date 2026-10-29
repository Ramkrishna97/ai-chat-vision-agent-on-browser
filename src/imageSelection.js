const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const categoriesFor = slot => slot.categories?.length ? slot.categories : slot.category ? [slot.category] : [];

export function suggestedImageRecipe(catalog, selectedFiles = []) {
  const recipes = catalog.recipes || [];
  if (recipes.length === 1) return recipes[0].id;
  if (catalog.status?.recipe && recipes.some(recipe => recipe.id === catalog.status.recipe)) return catalog.status.recipe;
  const diffusionNames = selectedFiles.filter(file => /\.gguf$/i.test(file.name)).map(file => normalized(file.name));
  const matches = recipes.map(recipe => {
    const names = [recipe.id, recipe.name].map(normalized).filter(name => name.length >= 8);
    return { recipe, score: Math.max(0, ...diffusionNames.flatMap(file => names.filter(name => file.startsWith(name)).map(name => name.length))) };
  }).sort((a, b) => b.score - a.score);
  if (matches[0]?.score && matches[0].score > (matches[1]?.score || 0)) return matches[0].recipe.id;
  const complete = recipes.filter(recipe => {
    const slots = recipe.slots || [];
    return slots.filter(slot => slot.required).every(slot => {
      const matches = (catalog.files || []).filter(file => categoriesFor(slot).includes(file.category));
      return recipe.models?.[slot.id] || matches.length === 1 && slots.filter(other => categoriesFor(other).some(category => categoriesFor(slot).includes(category))).length === 1;
    });
  });
  return complete.length === 1 ? complete[0].id : '';
}

export function suggestedImageFiles(recipe, catalog) {
  const selection = {};
  for (const slot of recipe?.slots || []) {
    const defaults = recipe.models?.[slot.id];
    if (defaults && (catalog.files || []).some(file => file.id === defaults)) {
      selection[slot.id] = `existing:${defaults}`;
      continue;
    }
    const categories = categoriesFor(slot);
    const candidates = (catalog.files || []).filter(file => categories.includes(file.category));
    const competing = (recipe.slots || []).filter(other => categoriesFor(other).some(category => categories.includes(category)));
    if (candidates.length === 1 && competing.length === 1) selection[slot.id] = `existing:${candidates[0].id}`;
  }
  return selection;
}
