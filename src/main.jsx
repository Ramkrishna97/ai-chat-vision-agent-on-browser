import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, FolderOpen, Image, Menu, MessageCircle, Moon, Paperclip, Plus, RefreshCw, Settings, Sparkles, Square, Sun, Terminal, Trash2, X } from 'lucide-react';
import { listChats, saveChat, deleteChat } from './storage.js';
import { loadGguf, getGgufModel, validateGguf } from './localModels.js';
import { discoverOllama, discoverSkills, discoverImageModels, startImageEngine, pairLocalBridge, complete, generateImage, runAgent, offloadModel, activateModel, uploadImageModelFile, loadImageModel } from './engine.js';
import { stoppedResult } from './stoppedResult.js';
import { contextLimit, estimatedConversationTokens } from './contextUsage.js';
import Conversation from './Conversation.jsx';
import ImageModelSetup from './ImageModelSetup.jsx';
import { ggufInfo } from './ggufKind.js';
import { modelDisplayName } from './modelDisplay.js';
import './styles.css';
import './local.css';
import './improvements.css';

const base = { bridgeUrl: 'http://127.0.0.1:3210', bridgeToken: '', context: 2048, maxTokens: 1024, temperature: 0.7, defaultModel: '', defaultMode: 'chat', theme: 'dark', thinking: true, disabledSkills: [] };
const savedSettings = () => { try { return { ...base, ...JSON.parse(localStorage.getItem('lite-chat-settings') || '{}') }; } catch { return base; } };
const id = () => crypto.randomUUID();
const errText = error => error?.message || 'Something went wrong.';

function App() {
  const [settings, setSettings] = useState(savedSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState('chat');
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState('');
  const [imageSetup, setImageSetup] = useState(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState({ skills: [], customRoot: '' });
  const [steps, setSteps] = useState([]);
  const [liveAnswer, setLiveAnswer] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef(null);
  const ggufInput = useRef(null);
  const imageInput = useRef(null);
  const attachmentInput = useRef(null);
  const conversationRef = useRef(null);
  const followBottomRef = useRef(true);
  const activeIdRef = useRef('');
  const chatsRef = useRef([]);
  const model = models.find(item => item.id === selected);
  const caps = model?.capabilities || {};
  const modes = ['chat', 'agent', 'image'];
  const modeSupported = name => name === 'chat' ? !!caps.chat : name === 'image' ? !!caps.imageGeneration : !!(caps.chat && caps.tools);
  const supportsMode = (item, name) => name === 'chat' ? !!item?.capabilities.chat : name === 'image' ? !!item?.capabilities.imageGeneration : !!(item?.capabilities.chat && item?.capabilities.tools);

  useEffect(() => { localStorage.setItem('lite-chat-settings', JSON.stringify(settings)); document.documentElement.dataset.theme = settings.theme; }, [settings]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);
  useEffect(() => {
    listChats().then(async all => {
      const requested = new URLSearchParams(location.search).get('chat');
      const active = all.find(chat => chat.id === requested) || all[0] || { id: id(), title: 'New conversation', messages: [], updatedAt: Date.now() };
      if (!all.length) await saveChat(active);
      setChats(all.length ? all : [active]); openChat(active);
    }).catch(error => setError(errText(error)));
    const pairing = new URLSearchParams(location.hash.slice(1)).get('pair');
    if (pairing) {
      const paired = { ...settings, bridgeToken: pairing };
      setSettings(paired);
      history.replaceState(null, '', location.pathname + location.search);
      refreshModels(true, paired);
    } else refreshModels(true);
  }, []);
  useEffect(() => {
    const panel = conversationRef.current;
    if (panel && followBottomRef.current) panel.scrollTop = panel.scrollHeight;
  }, [messages, steps, liveAnswer, busy, activeId]);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function openChat(chat) {
    followBottomRef.current = true;
    activeIdRef.current = chat.id; setActiveId(chat.id); setMessages(chat.messages || []);
    setShowChats(false);
    history.replaceState(null, '', '?chat=' + encodeURIComponent(chat.id));
  }
  async function persist(next) {
    const chatId = activeIdRef.current;
    const old = chatsRef.current.find(chat => chat.id === chatId);
    const title = old?.title && old.title !== 'New conversation' ? old.title : (next.find(item => item.role === 'user')?.text || 'New conversation').slice(0, 42);
    const chat = { id: chatId, title, messages: next, updatedAt: Date.now() };
    setMessages(next);
    setChats(previous => [chat, ...previous.filter(item => item.id !== chatId)]);
    await saveChat(chat);
  }
  async function refreshModels(silent = false, config = settings) {
    setModelBusy(true);
    try {
      const paired = await pairLocalBridge(config);
      if (paired.bridgeToken !== config.bridgeToken) { setSettings(paired); config = paired; }
      if (!silent && model) await offloadModel(model, config);
      const catalog = await discoverSkills(config);
      setSkillCatalog(catalog);
      const found = await discoverOllama(config).catch(error => { if (!silent) setError('Bridge connected, but Ollama is unavailable: ' + errText(error)); return []; });
      const all = getGgufModel() ? [...found, getGgufModel()] : found;
      setModels(all); setConnected(true);
      const nextId = silent ? all.find(item => item.id === config.defaultModel)?.id || all.find(item => item.capabilities.chat || item.capabilities.imageGeneration)?.id || all[0]?.id || '' : '';
      setSelected(nextId);
      const nextModel = all.find(item => item.id === nextId);
      const options = [nextModel?.capabilities.chat && 'chat', nextModel?.capabilities.imageGeneration && 'image', nextModel?.capabilities.chat && nextModel?.capabilities.tools && 'agent'].filter(Boolean);
      if (!options.includes(mode)) setMode(options.includes(config.defaultMode) ? config.defaultMode : options[0] || 'chat');
      if (!silent && found.length) setError('');
    } catch (error) {
      setConnected(false);
      setSkillCatalog({ skills: [], customRoot: '' });
      if (getGgufModel()) { setModels([getGgufModel()]); setSelected(silent ? getGgufModel().id : ''); }
      else { setModels([]); setSelected(''); }
      if (!silent) setError(errText(error));
    }
    finally { setModelBusy(false); }
  }
  async function loadLocal(event) {
    const picked = Array.from(event.target.files || []); event.target.value = '';
    if (!picked.length) return;
    setLoading(true); setError('');
    try {
      await validateGguf(picked);
      const metadata = await Promise.all(picked.map(ggufInfo));
      if (metadata.every(item => item.complete && !item.hasTokenizer)) {
        await openImageSetup(picked);
        return;
      }
      if (model) await offloadModel(model, settings).catch(error => setError(errText(error)));
      const local = await loadGguf(picked, Number(settings.context));
      setModels(previous => [...previous.filter(item => item.source !== 'gguf'), local]);
      setSelected(local.id); setMode('chat'); setFiles([]);
    } catch (error) {
      setError(errText(error));
      setSelected('');
      if (!getGgufModel()) setModels(previous => previous.filter(item => item.source !== 'gguf'));
    }
    finally { setLoading(false); setLoadStatus(''); }
  }
  async function openImageSetup(picked = []) {
    if (!Array.isArray(picked)) picked = [];
    setError(''); setLoading(true);
    let config = settings;
    try {
      config = await pairLocalBridge(settings);
      if (config !== settings) setSettings(config);
      if (!config.bridgeToken) throw new Error('Start the local bridge and enter its pairing code in Settings before loading an image model.');
      setLoadStatus('Preparing image engine (first setup downloads the Windows runtime)…');
      await startImageEngine(config);
      const catalog = await discoverImageModels(config);
      setImageSetup({ files: picked, catalog, config, connectionError: '' });
    } catch (error) { setImageSetup({ files: picked, catalog: { recipes: [], files: [] }, config, connectionError: errText(error) }); }
    finally { setLoading(false); setLoadStatus(''); }
  }
  async function refreshImageSetup() {
    if (!imageSetup) return;
    setLoading(true);
    try {
      const config = await pairLocalBridge(imageSetup.config);
      if (config !== imageSetup.config) setSettings(config);
      if (!config.bridgeToken) throw new Error('Enter the pairing code printed by the local bridge in Settings.');
      setLoadStatus('Preparing image engine (first setup downloads the Windows runtime)…');
      await startImageEngine(config);
      const catalog = await discoverImageModels(config);
      setImageSetup(previous => ({ ...previous, config, catalog, connectionError: '' }));
    } catch (error) { setImageSetup(previous => ({ ...previous, connectionError: errText(error) })); }
    finally { setLoading(false); setLoadStatus(''); }
  }
  async function selectImageFiles(event) {
    const picked = Array.from(event.target.files || []); event.target.value = '';
    if (!picked.length) return;
    try {
      const ggufFiles = picked.filter(file => file.name.toLowerCase().endsWith('.gguf'));
      if (ggufFiles.length) await validateGguf(ggufFiles);
      setImageSetup(previous => previous ? { ...previous, files: [...previous.files, ...picked] } : previous);
    } catch (error) { setError(errText(error)); }
  }
  async function loadSelectedImage(recipe, selection) {
    if (!imageSetup) return;
    setLoading(true); setError('');
    try {
      const { files: picked, config } = imageSetup;
      const missing = (recipe.slots || []).filter(slot => slot.required && !selection[slot.id]).map(slot => slot.label || slot.id);
      for (const group of recipe.required_any || []) {
        if (!group.some(slotId => selection[slotId])) missing.push(`one of ${group.map(slotId => recipe.slots.find(slot => slot.id === slotId)?.label || slotId).join(' or ')}`);
      }
      if (missing.length) throw new Error(`This model needs ${missing.join(' and ')}. Add those files or choose files already on this device before loading.`);
      const selectedFiles = {};
      for (const slot of recipe.slots || []) {
        const value = selection[slot.id];
        if (!value) continue;
        if (value.startsWith('existing:')) { selectedFiles[slot.id] = value.slice(9); continue; }
        const index = Number(value.slice(6));
        const file = picked[index];
        const category = slot.categories?.[0] || slot.category;
        if (!value.startsWith('local:') || !file || !category) throw new Error(`Choose a valid file for ${slot.label || slot.id}.`);
        setLoadStatus(`Copying ${file.name} to the local image server…`);
        await uploadImageModelFile(file, category, config);
        selectedFiles[slot.id] = { category, name: file.name };
      }
      setLoadStatus('Loading the selected image recipe…');
      const catalog = await discoverImageModels(config);
      const resolved = {};
      for (const [slotId, value] of Object.entries(selectedFiles)) {
        if (typeof value === 'string') { resolved[slotId] = value; continue; }
        const found = catalog.files.find(file => file.category === value.category && String(file.relative_path || file.name).split(/[\\/]/).at(-1) === value.name);
        if (!found) throw new Error(`The image server cannot see ${value.name}. Check that sd-server uses --model-dir ${catalog.modelDir}.`);
        resolved[slotId] = found.id;
      }
      const result = await loadImageModel(recipe.id, resolved, config);
      if (result.missing?.length) throw new Error(`Choose ${result.missing.join(' and ')} for this recipe.`);
      if (!result.imageGeneration) throw new Error(`This loaded recipe does not advertise image generation${result.supportedModes.length ? ` (reported modes: ${result.supportedModes.join(', ')})` : ''}. Choose a recipe whose engine supports image generation.`);
      if (model && model.source !== 'sdcpp') await offloadModel(model, config);
      const found = await discoverOllama(config);
      setModels(getGgufModel() ? [...found, getGgufModel()] : found);
      const loaded = found.find(item => item.source === 'sdcpp' && item.capabilities.imageGeneration);
      if (!loaded) throw new Error('The image server loaded a model, but did not report an available image generation model. Refresh and try again.');
      setSelected(loaded.id); setMode('image'); setFiles([]); setConnected(true); setImageSetup(null);
    } catch (error) { setError(errText(error)); }
    finally { setLoading(false); setLoadStatus(''); }
  }
  async function chooseModel(value, requestedMode) {
    if (value === selected || modelBusy) return;
    setModelBusy(true); setFiles([]); setError('');
    const next = models.find(item => item.id === value);
    try {
      if (model) await offloadModel(model, settings);
      if (next && (next.capabilities.chat || next.capabilities.imageGeneration)) await activateModel(next, settings);
      setSelected(value);
      const options = [next?.capabilities.chat && 'chat', next?.capabilities.imageGeneration && 'image', next?.capabilities.chat && next?.capabilities.tools && 'agent'].filter(Boolean);
      setMode(requestedMode && options.includes(requestedMode) ? requestedMode : options.includes(settings.defaultMode) ? settings.defaultMode : options[0] || 'chat');
    } catch (error) { setError(errText(error)); setSelected(''); }
    finally { setModelBusy(false); }
  }
  async function chooseMode(name) {
    if (busy || loading || modelBusy) return;
    if (modeSupported(name) && (name !== 'agent' || connected)) { setMode(name); setFiles([]); return; }
    if (name === 'image') { await openImageSetup(); return; }
    if (name === 'agent' && !connected) { setError('Start and connect the local bridge to use Agent mode.'); setShowSettings(true); return; }
    const candidate = models.find(item => supportsMode(item, name));
    if (candidate) { await chooseModel(candidate.id, name); return; }
    setError(name === 'agent' ? 'Load a tool-capable chat model to use Agent mode.' : 'Load a chat model first.');
  }
  async function newChat() {
    const chat = { id: id(), title: 'New conversation', messages: [], updatedAt: Date.now() };
    await saveChat(chat);
    setChats(previous => [chat, ...previous]);
    openChat(chat);
  }
  async function removeChat(chatId) {
    await deleteChat(chatId);
    const left = chatsRef.current.filter(chat => chat.id !== chatId);
    setChats(left);
    if (chatId === activeId) {
      const next = left[0] || { id: id(), title: 'New conversation', messages: [], updatedAt: Date.now() };
      if (!left.length) { await saveChat(next); setChats([next]); }
      openChat(next);
    }
  }
  function addAttachments(event) {
    const picked = Array.from(event.target.files || []); event.target.value = '';
    const allowed = picked.filter(file => {
      const image = /^image\/(png|jpeg|webp|gif)$/.test(file.type);
      const audio = file.type === 'audio/wav' || file.type === 'audio/x-wav' || file.name.toLowerCase().endsWith('.wav');
      const text = /\.(txt|md|csv|json|js|jsx|ts|tsx|py|java|css|html|xml|yml|yaml)$/i.test(file.name);
      if (file.size > 2 * 1024 * 1024 || !(image && caps.vision || audio && caps.audio || text && caps.file)) { setError(file.name + ' is too large or unsupported by this model.'); return false; }
      return true;
    });
    setFiles(previous => [...previous, ...allowed].slice(0, 4));
  }
  async function dataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
  async function send() {
    const text = draft.trim();
    if (!text || !model || busy) return;
    if (!modeSupported(mode)) { setError('This model does not advertise a mode supported by Lite Chat. Choose a chat or image generation model.'); return; }
    if (mode === 'agent' && !connected) { setError('Agent mode needs the local bridge. Start it on this device, pair it in Settings, and connect to Ollama.'); setShowSettings(true); return; }
    followBottomRef.current = true;
    setError(''); setBusy(true); setSteps([]); setLiveAnswer(null);
    const selectedFiles = files;
    const before = messages;
    const user = { id: id(), role: 'user', text, files: selectedFiles.map(file => file.name), mode };
    const controller = new AbortController(); abortRef.current = controller;
    const trace = [];
    let partialAnswer = null;
    try {
      await persist([...before, user]);
      setDraft(''); setFiles([]);
      let result;
      if (mode === 'image') result = { image: await generateImage(model, text, settings, controller.signal) };
      else if (mode === 'agent') {
        const history = before.filter(item => item.text).slice(-12).map(item => ({ role: item.role, content: item.text }));
        const textFiles = selectedFiles.filter(file => !file.type.startsWith('image/') && !file.type.startsWith('audio/') && !file.name.toLowerCase().endsWith('.wav'));
        const taskText = text + (await Promise.all(textFiles.map(async file => '\n\n[Attached file: ' + file.name + ']\n' + (await file.text()).slice(0, 30000)))).join('');
        const mediaFiles = selectedFiles.filter(file => file.type.startsWith('image/') || file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.wav'));
        const media = await Promise.all(mediaFiles.map(async file => ({ type: file.type.startsWith('image/') ? 'image' : 'audio', bytes: await file.arrayBuffer(), base64: model.source === 'ollama' ? (await dataUrl(file)).split(',')[1] : undefined })));
        const final = await runAgent(model, taskText, history, settings, controller.signal, step => { if (step.replace && trace.at(-1)?.kind === step.kind) trace[trace.length - 1] = step; else trace.push(step); setSteps([...trace]); }, activeId, media);
        result = { text: final, steps: trace };
      } else {
        const textFiles = selectedFiles.filter(file => !file.type.startsWith('image/') && !file.type.startsWith('audio/') && !file.name.toLowerCase().endsWith('.wav'));
        const mediaFiles = selectedFiles.filter(file => file.type.startsWith('image/') || file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.wav'));
        const extra = (await Promise.all(textFiles.map(async file => '\n\n[File: ' + file.name + ']\n' + (await file.text()).slice(0, 30000)))).join('');
        const media = await Promise.all(mediaFiles.map(async file => ({ type: file.type.startsWith('image/') ? 'image' : 'audio', bytes: await file.arrayBuffer() })));
        const history = before.filter(item => item.text && item.mode !== 'image').slice(-12).map(item => ({ role: item.role, content: item.text }));
        const prompt = text + extra;
        const current = model.source === 'ollama'
          ? { role: 'user', content: prompt, ...(media.length ? { images: await Promise.all(mediaFiles.map(async file => (await dataUrl(file)).split(',')[1])) } : {}) }
          : { role: 'user', content: media.length ? [...media.map(item => ({ type: item.type, data: item.bytes })), { type: 'text', text: prompt }] : prompt };
        const answer = await complete(model, [...history, current], settings, controller.signal, undefined, update => { partialAnswer = update; setLiveAnswer(update); });
        result = { text: answer.content || '(No text returned)', thinking: answer.thinking || '', usage: answer.usage || null };
      }
      if (controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      await persist([...before, user, { id: id(), role: 'assistant', mode, ...result }]);
    } catch (error) {
      if (controller.signal.aborted) {
        const partial = stoppedResult(mode, partialAnswer, trace);
        if (partial) await persist([...before, user, { id: id(), role: 'assistant', mode, ...partial }]);
      } else setError(errText(error));
      if (model.source === 'gguf' && /browser lost access to the GGUF file/.test(errText(error))) {
        setModels(previous => previous.filter(item => item.source !== 'gguf'));
        setSelected('');
      }
    }
    finally { abortRef.current = null; setBusy(false); setLiveAnswer(null); setSteps([]); }
  }
  const update = (key, value) => setSettings(previous => ({ ...previous, [key]: value }));
  const attachable = (mode === 'chat' || mode === 'agent') && (caps.vision || caps.file || caps.audio);
  const contextMax = contextLimit(settings, model);
  const reportedUsage = liveAnswer?.usage || (!busy && messages.findLast(item => item.role === 'assistant')?.usage);
  const liveContext = reportedUsage?.used ?? estimatedConversationTokens(messages, liveAnswer?.content || '');
  const contextApproximate = !reportedUsage;

  return <div className="app-shell">
    <aside className={'sidebar ' + (showChats ? 'show-mobile-chats' : '')}><div className="brand"><div className="brand-icon"><Sparkles size={18} /></div>lite<span className="brand-light">chat</span><button className="close-mobile-chats" onClick={() => setShowChats(false)} aria-label="Close chats"><X size={18} /></button></div>
      <button className="new-chat" onClick={newChat}><Plus size={17} /> New chat</button><div className="sidebar-label">YOUR CHATS</div>
      <div className="chat-list">{chats.map(chat => <div className={'chat-row ' + (chat.id === activeId ? 'active' : '')} key={chat.id}><button onClick={() => openChat(chat)}><MessageCircle size={15} /><span>{chat.title}</span></button><button className="delete-chat" onClick={() => removeChat(chat.id)} title="Delete chat"><Trash2 size={14} /></button></div>)}</div>
      <div className="sidebar-bottom"><span className={'status-dot ' + (connected ? '' : 'offline')} />{connected ? 'Bridge connected' : 'Browser mode'}<button onClick={() => setShowSettings(true)} title="Settings"><Settings size={16} /></button></div>
    </aside>
    <main className="main"><header className="topbar"><div className="top-title">{chats.find(chat => chat.id === activeId)?.title || 'New conversation'} <span className="top-muted">/ local AI</span></div><div className="mobile-brand"><Sparkles size={18} /> litechat</div>
      <div className="header-actions"><button className="icon-button mobile-new" onClick={() => setShowChats(true)} title="Chats" aria-label="Chats"><Menu size={19} /></button><button className="icon-button" onClick={() => ggufInput.current?.click()} title="Load chat GGUF"><FolderOpen size={18} /></button><button className="icon-button" onClick={openImageSetup} title="Load image model" aria-label="Load image model"><Image size={18} /></button><button className="icon-button" onClick={() => refreshModels()} title="Refresh models and unload current model" aria-label="Refresh models and unload current model" disabled={busy || loading || modelBusy}><RefreshCw size={17} /></button><button className="icon-button" onClick={() => setShowSettings(true)} title="Settings"><Settings size={18} /></button>
        <div className="model-picker"><span className="model-dot" />{models.length ? <select aria-label="Select model" value={selected} disabled={busy || loading || modelBusy} onChange={event => chooseModel(event.target.value)}><option value="">{loading ? 'Loading GGUF…' : modelBusy ? 'Switching…' : 'Select model'}</option>{models.map(item => <option key={item.id} value={item.id}>{modelDisplayName(item)}</option>)}</select> : <button className="model-connect" onClick={() => setShowSettings(true)}>Connect model</button>}</div></div><input ref={ggufInput} type="file" accept=".gguf" multiple hidden onChange={loadLocal} /><input ref={imageInput} type="file" multiple hidden onChange={selectImageFiles} />
    </header>
      <Conversation messages={messages} busy={busy} mode={mode} liveAnswer={liveAnswer} steps={steps} elapsed={elapsed} contextMax={contextMax} contextUsed={liveContext} contextApproximate={contextApproximate} conversationRef={conversationRef} followBottomRef={followBottomRef} model={model} bridgeModels={models.filter(item => item.source !== 'gguf')} connected={connected} loading={loading} modelBusy={modelBusy} onLoadGguf={() => ggufInput.current?.click()} onLoadImage={openImageSetup} onChooseModel={chooseModel} onRefreshOllama={() => refreshModels()} onSettings={() => setShowSettings(true)} />
      <div className="composer-zone"><div className="composer-wrap">{loadStatus && <div className="loading-banner" role="status">{loadStatus}</div>}{error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={15} /></button></div>}<div className="mode-row">{modes.map(name => <button key={name} className={'mode-tab ' + (mode === name ? 'selected' : '')} onClick={() => chooseMode(name)}>{name === 'chat' ? <MessageCircle size={15} /> : name === 'image' ? <Image size={15} /> : <Terminal size={15} />}{name === 'image' ? 'Image' : name === 'agent' ? 'Agent' : 'Chat'}</button>)}<span className="mode-hint">{model ? model.source + ' · ' + (modes.length ? Object.entries(caps).filter(([, value]) => value).map(([name]) => name).join(', ') : 'No supported chat or image mode') : 'Choose a model to begin'}</span></div><div className="composer">{files.length > 0 && <div className="attachments">{files.map((file, index) => <span key={index}><Paperclip size={13} />{file.name}<button onClick={() => setFiles(previous => previous.filter((_, i) => i !== index))}><X size={13} /></button></span>)}</div>}<textarea rows="2" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={!model ? 'Load a model to begin…' : !modes.length ? 'This model has no supported chat or image mode' : mode === 'agent' ? 'Describe the task to plan, build, and test…' : mode === 'image' ? 'Describe the image to create…' : 'Ask anything…'} aria-label="Message" /><div className="composer-actions"><div className="attach-wrap">{attachable && <><button className="attach-button" onClick={() => attachmentInput.current?.click()} title="Attach supported file"><Paperclip size={19} /></button><input ref={attachmentInput} type="file" hidden multiple accept={[caps.vision && 'image/png,image/jpeg,image/webp,image/gif', caps.audio && '.wav,audio/wav', caps.file && '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.css,.html'].filter(Boolean).join(',')} onChange={addAttachments} /></>}<span className="composer-tip">Enter to send · Shift + Enter for new line</span></div><button className={'send-button ' + (busy ? 'is-busy' : '')} onClick={busy ? () => abortRef.current?.abort() : send} disabled={!busy && (!draft.trim() || !model || !modeSupported(mode))} aria-label={busy ? 'Stop' : 'Send'}>{busy ? <Square size={16} fill="currentColor" /> : <ArrowUp size={20} />}</button></div></div><div className="footer-note">Runs on your device · Agent commands require a paired local bridge</div></div></div>
    </main>
    {imageSetup && <ImageModelSetup catalog={imageSetup.catalog} files={imageSetup.files} loading={loading} status={loadStatus} error={imageSetup.connectionError || error} onLoad={loadSelectedImage} onAddFiles={() => imageInput.current?.click()} onRetry={refreshImageSetup} onSettings={() => { setImageSetup(null); setShowSettings(true); }} onClose={() => setImageSetup(null)} />}
    {showSettings && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowSettings(false); }}><div className="settings-panel" role="dialog" aria-modal="true" aria-label="Settings"><div className="settings-head"><h2>Settings</h2><button onClick={() => setShowSettings(false)} aria-label="Close"><X size={20} /></button></div>
      <label>Theme <button className="theme-toggle" onClick={() => update('theme', settings.theme === 'dark' ? 'light' : 'dark')}>{settings.theme === 'dark' ? <><Moon size={15} /> Dark</> : <><Sun size={15} /> Light</>}</button></label>
      <label>Local bridge URL<input value={settings.bridgeUrl} onChange={event => update('bridgeUrl', event.target.value)} /></label>
      <label>Pairing code<input type="password" value={settings.bridgeToken} onChange={event => update('bridgeToken', event.target.value)} placeholder="Printed by npm run bridge" /></label>
      <button className="connect-button" onClick={() => refreshModels(false, settings)}><RefreshCw size={15} /> Connect & discover local models</button>
      <h3 className="settings-subhead">Local image generation</h3>
      <p className="settings-note">On Windows, Image mode starts the local image engine automatically and downloads the verified CPU release on first use. Add the model files requested by the detected model type. A diffusion GGUF usually also needs its matching text encoder and VAE.</p>
      <div className="settings-divider" />
      <label>Default model<select value={settings.defaultModel} onChange={event => update('defaultModel', event.target.value)}><option value="">First available</option>{models.map(item => <option key={item.id} value={item.id}>{modelDisplayName(item)}</option>)}</select></label>
      <label>Default mode<select value={settings.defaultMode} onChange={event => update('defaultMode', event.target.value)}><option value="chat">Chat</option><option value="agent">Agent</option><option value="image">Create image</option></select></label>
      <div className="settings-grid"><label>Context tokens<input type="number" min="512" max="32768" value={settings.context} onChange={event => update('context', Number(event.target.value))} /></label><label>Output tokens<input type="number" min="64" max="8192" value={settings.maxTokens} onChange={event => update('maxTokens', Number(event.target.value))} /></label></div>
      <label>Temperature<input type="number" min="0" max="2" step="0.1" value={settings.temperature} onChange={event => update('temperature', Number(event.target.value))} /></label>
      <label className="check-label"><input type="checkbox" checked={settings.thinking} onChange={event => update('thinking', event.target.checked)} /> Enable thinking when supported</label>
      <div className="settings-divider" />
      <h3 className="settings-subhead">Agent tools</h3>
      <p className="settings-note">Read and write files, list projects, run commands, build and test code, and read skills. Agent tools require the paired local bridge.</p>
      <h3 className="settings-subhead">Agent skills</h3>
      {skillCatalog.skills.length ? <div className="skill-list">{skillCatalog.skills.map(skill => <label className="skill-option" key={skill.id}><input type="checkbox" checked={!(settings.disabledSkills || []).includes(skill.id)} onChange={event => update('disabledSkills', event.target.checked ? (settings.disabledSkills || []).filter(id => id !== skill.id) : [...(settings.disabledSkills || []), skill.id])} /><span><strong>{skill.name}</strong><small>{skill.description}</small></span></label>)}</div> : <p className="settings-note">Connect the local bridge to see available skills.</p>}
      {skillCatalog.customRoot && <p className="settings-note">Add a custom skill as &lt;skill-name&gt;/SKILL.md under {skillCatalog.customRoot}, then reconnect.</p>}
      <p className="settings-note">GGUF runs in this browser; reopen its file after a page reload. Ollama and Agent need the bridge running on this same device. For a deployed site, start the bridge with APP_ORIGIN set to this site's HTTPS origin and allow the browser's local-network prompt. On a phone, 127.0.0.1 refers to the phone, not your PC.</p>
    </div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);




