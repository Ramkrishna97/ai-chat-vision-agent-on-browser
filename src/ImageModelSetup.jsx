import React, { useEffect, useState } from 'react';
import { suggestedImageRecipe, suggestedImageFiles } from './imageSelection.js';
import { ggufInfo } from './ggufKind.js';

export default function ImageModelSetup({ catalog, files, loading, status, error, onLoad, onAddFiles, onRetry, onSettings, onClose }) {
  const [recipeId, setRecipeId] = useState(() => suggestedImageRecipe(catalog, files));
  const [selection, setSelection] = useState({});
  const [fileKinds, setFileKinds] = useState({});
  const [chooseRecipe, setChooseRecipe] = useState(false);
  const recipes = catalog.recipes || [];
  const recipe = recipes.find(item => item.id === recipeId);

  useEffect(() => {
    if (!recipeId) setRecipeId(suggestedImageRecipe(catalog, files));
  }, [recipeId, catalog, files]);
  useEffect(() => {
    if (!recipe || Object.keys(selection).length) return;
    const suggested = suggestedImageFiles(recipe, catalog);
    if (Object.keys(suggested).length) setSelection(suggested);
  }, [recipe, catalog, selection]);
  useEffect(() => {
    if (!recipe || !files.length) return;
    let active = true;
    Promise.all(files.map(async (file, index) => file.name.toLowerCase().endsWith('.gguf') ? { index, info: await ggufInfo(file) } : null)).then(results => {
      if (!active) return;
      setFileKinds(Object.fromEntries(results.filter(Boolean).map(({ index, info }) => [index, info.hasTokenizer ? 'text_encoders' : /clip|vision|projector/i.test(info.architecture) ? '' : 'diffusion_models'])));
      const diffusion = results.filter(item => item?.info.complete && !item.info.hasTokenizer);
      const slots = (recipe.slots || []).filter(slot => (slot.categories || [slot.category]).includes('diffusion_models'));
      if (diffusion.length === 1 && slots.length === 1) setSelection(previous => previous[slots[0].id] ? previous : { ...previous, [slots[0].id]: `local:${diffusion[0].index}` });
    }).catch(() => {});
    return () => { active = false; };
  }, [recipe, files]);
  const missing = recipe ? [
    ...(recipe.slots || []).filter(slot => slot.required && !selection[slot.id]).map(slot => slot.label || slot.id),
    ...(recipe.required_any || []).filter(group => !group.some(id => selection[id])).map(group => group.map(id => recipe.slots.find(slot => slot.id === id)?.label || id).join(' or ')),
  ] : [];

  return <div className="modal-backdrop image-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !loading) onClose(); }}>
    <form className="image-setup-panel" role="dialog" aria-modal="true" aria-label="Load image model" onSubmit={event => { event.preventDefault(); if (recipe) onLoad(recipe, selection); }}>
      <div className="image-setup-head"><h2>Load image model</h2><button type="button" onClick={onClose} disabled={loading} aria-label="Close">×</button></div>
      <p>The app detects the model type and available files. Add any missing components below.</p>
      {files.length > 0 && <small>Selected: {files.map(file => file.name).join(', ')}</small>}
      {!recipes.length ? <div className="image-engine-help">
        <strong>Image engine not ready</strong>
        <p>{error || 'Could not detect the local image engine.'}</p>
        <p>On Windows, start Lite Chat with <code>start.bat</code>, then retry. The app downloads and starts the image engine automatically. A deployed website needs its local bridge connected first.</p>
        <div><button type="button" onClick={onRetry} disabled={loading}>Retry image setup</button><button type="button" onClick={onSettings}>Bridge settings</button></div>
      </div> : <>
        <button className="image-add-files" type="button" onClick={onAddFiles} disabled={loading}>Add model files from this device</button>
        {(files.length > 0 || catalog.files.length > 0) && (recipe && !chooseRecipe ? <p>Detected model type: <strong>{recipe.name || recipe.id}</strong> {recipes.length > 1 && <button type="button" onClick={() => setChooseRecipe(true)}>Change</button>}</p> : <label>Model type<select value={recipeId} disabled={loading} onChange={event => { setRecipeId(event.target.value); setSelection({}); }}><option value="">Choose model type</option>{[...recipes].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)).map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>)}
        {recipe && <>
          {recipe.description && <p>{recipe.description}</p>}
          {recipe.model_url?.startsWith('https://') && <a href={recipe.model_url} target="_blank" rel="noreferrer">Model download page</a>}
          {(recipe.slots || []).map(slot => {
            const categories = slot.categories?.length ? slot.categories : slot.category ? [slot.category] : [];
            const available = catalog.files.filter(item => categories.includes(item.category));
            return <label key={slot.id}>{slot.label || slot.id}{slot.required ? ' *' : ''}
              <select value={selection[slot.id] || ''} disabled={loading} onChange={event => setSelection(previous => ({ ...previous, [slot.id]: event.target.value }))}>
                <option value="">{slot.required ? 'Choose a file' : 'None'}</option>
                {files.map((file, index) => !fileKinds[index] || categories.includes(fileKinds[index]) ? <option key={`local:${index}`} value={`local:${index}`}>{file.name} (selected file)</option> : null)}
                {available.map(file => <option key={file.id} value={`existing:${file.id}`}>{file.name} (on device)</option>)}
              </select>
            </label>;
          })}
          {(recipe.required_any || []).map((group, index) => <small key={index}>Choose at least one: {group.map(id => recipe.slots.find(slot => slot.id === id)?.label || id).join(' or ')}</small>)}
        </>}
      </>}
      {status && <p className="image-setup-status" role="status">{status}</p>}
      {recipe && missing.length > 0 && <p>Still needed: {missing.join('; ')}. Add these files to generate images.</p>}
      {error && recipes.length > 0 && <p className="image-setup-error" role="alert">{error}</p>}
      <div className="image-setup-actions"><button type="button" onClick={onClose} disabled={loading}>Cancel</button><button type="submit" disabled={!recipe || loading || missing.length > 0}>{loading ? 'Loading…' : 'Load image model'}</button></div>
    </form>
  </div>;
}
