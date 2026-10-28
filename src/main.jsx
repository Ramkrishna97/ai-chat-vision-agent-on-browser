import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownToLine, ArrowUp, FolderOpen, Image, Menu, MessageCircle, Moon, Paperclip, Plus, RefreshCw, Settings, Sparkles, Square, Sun, Terminal, Trash2, X } from 'lucide-react';
import { listChats, saveChat, deleteChat } from './storage.js';
import { loadGguf, getGgufModel, validateGguf } from './localModels.js';
import { discoverOllama, pairLocalBridge, complete, generateImage, runAgent, offloadModel, activateModel } from './engine.js';
import { stoppedResult } from './stoppedResult.js';
import './styles.css';
import './local.css';
import './improvements.css';

const base = { bridgeUrl: 'http://127.0.0.1:3210', bridgeToken: '', context: 2048, maxTokens: 1024, temperature: 0.7, defaultModel: '', defaultMode: 'chat', theme: 'dark', thinking: true };
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
  const [modelBusy, setModelBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [steps, setSteps] = useState([]);
  const [liveAnswer, setLiveAnswer] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef(null);
  const ggufInput = useRef(null);
  const attachmentInput = useRef(null);
  const bottom = useRef(null);
  const activeIdRef = useRef('');
  const chatsRef = useRef([]);
  const model = models.find(item => item.id === selected);
  const caps = model?.capabilities || {};
  const modes = [caps.chat && 'chat', caps.imageGeneration && 'image', caps.tools && 'agent'].filter(Boolean);

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
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, steps, busy]);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function openChat(chat) {
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
      const found = await discoverOllama(config);
      const all = getGgufModel() ? [...found, getGgufModel()] : found;
      setModels(all); setConnected(true);
      const nextId = silent ? all.find(item => item.id === config.defaultModel)?.id || all[0]?.id || '' : '';
      setSelected(nextId);
      const nextModel = all.find(item => item.id === nextId);
      const options = [nextModel?.capabilities.chat && 'chat', nextModel?.capabilities.imageGeneration && 'image', nextModel?.capabilities.tools && 'agent'].filter(Boolean);
      if (!options.includes(mode)) setMode(options.includes(config.defaultMode) ? config.defaultMode : options[0] || 'chat');
      if (!silent) setError('');
    } catch (error) {
      setConnected(false);
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
      if (model) await offloadModel(model, settings).catch(error => setError(errText(error)));
      const local = await loadGguf(picked, Number(settings.context));
      setModels(previous => [...previous.filter(item => item.source !== 'gguf'), local]);
      setSelected(local.id); setMode('chat'); setFiles([]);
    } catch (error) {
      setError(errText(error));
      setSelected('');
      if (!getGgufModel()) setModels(previous => previous.filter(item => item.source !== 'gguf'));
    }
    finally { setLoading(false); }
  }
  async function chooseModel(value) {
    if (value === selected || modelBusy) return;
    setModelBusy(true); setFiles([]); setError('');
    const next = models.find(item => item.id === value);
    try {
      if (model) await offloadModel(model, settings);
      if (next) await activateModel(next, settings);
      setSelected(value);
      const options = [next?.capabilities.chat && 'chat', next?.capabilities.imageGeneration && 'image', next?.capabilities.tools && 'agent'].filter(Boolean);
      setMode(options.includes(settings.defaultMode) ? settings.defaultMode : options[0] || 'chat');
    } catch (error) { setError(errText(error)); setSelected(''); }
    finally { setModelBusy(false); }
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
    if (mode === 'agent' && !connected) { setError('Agent mode needs the local bridge. Start it on this device, pair it in Settings, and connect to Ollama.'); setShowSettings(true); return; }
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
        const final = await runAgent(model, text, history, settings, controller.signal, step => { if (step.replace && trace.at(-1)?.kind === step.kind) trace[trace.length - 1] = step; else trace.push(step); setSteps([...trace]); });
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
        result = { text: answer.content || '(No text returned)', thinking: answer.thinking || '' };
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
  const attachable = mode === 'chat' && (caps.vision || caps.file || caps.audio);

  return <div className="app-shell">
    <aside className={'sidebar ' + (showChats ? 'show-mobile-chats' : '')}><div className="brand"><div className="brand-icon"><Sparkles size={18} /></div>lite<span className="brand-light">chat</span><button className="close-mobile-chats" onClick={() => setShowChats(false)} aria-label="Close chats"><X size={18} /></button></div>
      <button className="new-chat" onClick={newChat}><Plus size={17} /> New chat</button><div className="sidebar-label">YOUR CHATS</div>
      <div className="chat-list">{chats.map(chat => <div className={'chat-row ' + (chat.id === activeId ? 'active' : '')} key={chat.id}><button onClick={() => openChat(chat)}><MessageCircle size={15} /><span>{chat.title}</span></button><button className="delete-chat" onClick={() => removeChat(chat.id)} title="Delete chat"><Trash2 size={14} /></button></div>)}</div>
      <div className="sidebar-bottom"><span className={'status-dot ' + (connected ? '' : 'offline')} />{connected ? 'Bridge connected' : 'Browser mode'}<button onClick={() => setShowSettings(true)} title="Settings"><Settings size={16} /></button></div>
    </aside>
    <main className="main"><header className="topbar"><div className="top-title">{chats.find(chat => chat.id === activeId)?.title || 'New conversation'} <span className="top-muted">/ local AI</span></div><div className="mobile-brand"><Sparkles size={18} /> litechat</div>
      <div className="header-actions"><button className="icon-button mobile-new" onClick={() => setShowChats(true)} title="Chats" aria-label="Chats"><Menu size={19} /></button><button className="icon-button" onClick={() => ggufInput.current?.click()} title="Load GGUF"><FolderOpen size={18} /></button><button className="icon-button" onClick={() => refreshModels()} title="Refresh models and unload current model" aria-label="Refresh models and unload current model" disabled={busy || loading || modelBusy}><RefreshCw size={17} /></button><button className="icon-button" onClick={() => setShowSettings(true)} title="Settings"><Settings size={18} /></button>
        <div className="model-picker"><span className="model-dot" />{models.length ? <select aria-label="Select model" value={selected} disabled={busy || loading || modelBusy} onChange={event => chooseModel(event.target.value)}><option value="">{loading ? 'Loading GGUF…' : modelBusy ? 'Switching…' : 'Select model'}</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <button className="model-connect" onClick={() => setShowSettings(true)}>Connect model</button>}</div></div><input ref={ggufInput} type="file" accept=".gguf" multiple hidden onChange={loadLocal} />
    </header>
      <section className="conversation" aria-label="Conversation">{messages.length ? <div className="message-list">{messages.map(item => <div className={'message ' + item.role} key={item.id}>{item.role === 'assistant' && <div className="avatar"><Sparkles size={16} /></div>}<div className="message-content">{item.role === 'assistant' && <div className="message-author">Lite Chat</div>}{item.text && <div className="message-text">{item.text}</div>}{item.files?.length > 0 && <div className="message-files">{item.files.map(name => <span key={name}><Paperclip size={12} />{name}</span>)}</div>}{item.thinking && <details className="thinking-block"><summary>Thinking</summary><pre>{item.thinking}</pre></details>}{item.steps && <StepList steps={item.steps} />}{item.image && <div className="generated-image"><img src={item.image} alt="Generated artwork" /><a href={item.image} download="local-image.png"><ArrowDownToLine size={16} /> Download</a></div>}</div></div>)}{busy && <div className="message assistant"><div className="avatar"><Sparkles size={16} /></div><div className="message-content"><div className="message-author">{mode === "image" ? "Creating image" : mode === "agent" ? "Planning and running" : liveAnswer?.content ? "Writing response" : "Reading your request"} · {elapsed}s</div>{liveAnswer?.thinking && <details className="thinking-block" open><summary>Thinking</summary><pre>{liveAnswer.thinking}</pre></details>}{liveAnswer?.content ? <div className="message-text">{liveAnswer.content}<span className="live-cursor" /></div> : steps.length ? <StepList steps={steps} /> : <div className="work-indicator"><span /><span /><span /></div>}</div></div>}<div ref={bottom} /></div> : <div className="welcome"><div className="welcome-icon"><Sparkles size={29} /></div><div className="eyebrow">LOCAL AI WORKSPACE</div><h1>Your ideas, <em>your device.</em></h1><p>Connect Ollama or open a GGUF model to begin.<br />Your chats stay in this browser.</p><div className="start-actions"><button onClick={() => ggufInput.current?.click()}><FolderOpen size={17} /> Load GGUF</button><button onClick={() => setShowSettings(true)}><Settings size={17} /> Connect Ollama</button></div></div>}</section>
      <div className="composer-zone"><div className="composer-wrap">{error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={15} /></button></div>}<div className="mode-row">{modes.map(name => <button key={name} className={'mode-tab ' + (mode === name ? 'selected' : '')} onClick={() => { if (name === 'agent' && !connected) { setError('Connect the local bridge in Settings before using Agent mode.'); setShowSettings(true); return; } setMode(name); setFiles([]); }}>{name === 'chat' ? <MessageCircle size={15} /> : name === 'image' ? <Image size={15} /> : <Terminal size={15} />}{name === 'image' ? 'Create image' : name === 'agent' ? 'Agent' : 'Chat'}</button>)}<span className="mode-hint">{model ? model.source + ' · ' + Object.entries(caps).filter(([, value]) => value).map(([name]) => name).join(', ') : 'Choose a model to begin'}</span></div><div className="composer">{files.length > 0 && <div className="attachments">{files.map((file, index) => <span key={index}><Paperclip size={13} />{file.name}<button onClick={() => setFiles(previous => previous.filter((_, i) => i !== index))}><X size={13} /></button></span>)}</div>}<textarea rows="2" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={!model ? 'Load a model to begin…' : mode === 'agent' ? 'Describe the task to plan, build, and test…' : mode === 'image' ? 'Describe the image to create…' : 'Ask anything…'} aria-label="Message" /><div className="composer-actions"><div className="attach-wrap">{attachable && <><button className="attach-button" onClick={() => attachmentInput.current?.click()} title="Attach supported file"><Paperclip size={19} /></button><input ref={attachmentInput} type="file" hidden multiple accept={[caps.vision && 'image/png,image/jpeg,image/webp,image/gif', caps.audio && '.wav,audio/wav', caps.file && '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.css,.html'].filter(Boolean).join(',')} onChange={addAttachments} /></>}<span className="composer-tip">Enter to send · Shift + Enter for new line</span></div><button className={'send-button ' + (busy ? 'is-busy' : '')} onClick={busy ? () => abortRef.current?.abort() : send} disabled={!busy && (!draft.trim() || !model)} aria-label={busy ? 'Stop' : 'Send'}>{busy ? <Square size={16} fill="currentColor" /> : <ArrowUp size={20} />}</button></div></div><div className="footer-note">Runs on your device · Agent commands require a paired local bridge</div></div></div>
    </main>
    {showSettings && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowSettings(false); }}><div className="settings-panel" role="dialog" aria-modal="true" aria-label="Settings"><div className="settings-head"><h2>Settings</h2><button onClick={() => setShowSettings(false)} aria-label="Close"><X size={20} /></button></div>
      <label>Theme <button className="theme-toggle" onClick={() => update('theme', settings.theme === 'dark' ? 'light' : 'dark')}>{settings.theme === 'dark' ? <><Moon size={15} /> Dark</> : <><Sun size={15} /> Light</>}</button></label>
      <label>Local bridge URL<input value={settings.bridgeUrl} onChange={event => update('bridgeUrl', event.target.value)} /></label>
      <label>Pairing code<input type="password" value={settings.bridgeToken} onChange={event => update('bridgeToken', event.target.value)} placeholder="Printed by npm run bridge" /></label>
      <button className="connect-button" onClick={() => refreshModels(false, settings)}><RefreshCw size={15} /> Connect & discover Ollama</button>
      <div className="settings-divider" />
      <label>Default model<select value={settings.defaultModel} onChange={event => update('defaultModel', event.target.value)}><option value="">First available</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Default mode<select value={settings.defaultMode} onChange={event => update('defaultMode', event.target.value)}><option value="chat">Chat</option><option value="agent">Agent</option><option value="image">Create image</option></select></label>
      <div className="settings-grid"><label>Context tokens<input type="number" min="512" max="32768" value={settings.context} onChange={event => update('context', Number(event.target.value))} /></label><label>Output tokens<input type="number" min="64" max="8192" value={settings.maxTokens} onChange={event => update('maxTokens', Number(event.target.value))} /></label></div>
      <label>Temperature<input type="number" min="0" max="2" step="0.1" value={settings.temperature} onChange={event => update('temperature', Number(event.target.value))} /></label>
      <label className="check-label"><input type="checkbox" checked={settings.thinking} onChange={event => update('thinking', event.target.checked)} /> Enable thinking when supported</label>
      <p className="settings-note">GGUF runs in this browser; reopen its file after a page reload. Ollama and Agent need the bridge running on this same device. For a deployed site, start the bridge with APP_ORIGIN set to this site's HTTPS origin and allow the browser's local-network prompt. On a phone, 127.0.0.1 refers to the phone, not your PC.</p>
    </div></div>}
  </div>;
}

function StepList({ steps }) { return <div className="step-list">{steps.map((step, index) => step.kind === 'plan' || step.kind === 'thought'
  ? <details className={'step ' + step.kind} key={`${index}-${!!step.live}`} open={!!step.live}><summary>{step.kind === 'plan' ? 'Plan' : 'Thinking'}{step.live ? ' · live' : ''}</summary><pre>{step.text}</pre></details>
  : <div className={'step ' + step.kind} key={index}><strong>{step.kind === 'command' ? 'Command' : 'Result'}</strong><pre>{step.text}</pre></div>)}</div>; }
createRoot(document.getElementById('root')).render(<App />);
