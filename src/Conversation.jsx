import React, { useState } from 'react';
import { ArrowDownToLine, Check, Copy, FolderOpen, Paperclip, Settings, Sparkles } from 'lucide-react';
import { splitFencedCode } from './responseFormat.js';

function CopyButton({ text, label }) {
  const [status, setStatus] = useState('idle');
  async function copy() {
    try { await navigator.clipboard.writeText(text); setStatus('copied'); }
    catch { setStatus('failed'); }
    setTimeout(() => setStatus('idle'), 2000);
  }
  return <button className="copy-button" onClick={copy} title={label} aria-label={label}>{status === 'copied' ? <Check size={14} /> : <Copy size={14} />}{status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}</button>;
}

function ResponseBody({ text }) {
  return <div className="response-body">{splitFencedCode(text).map((part, index) => part.type === 'code'
    ? <div className="code-block" key={index}><div className="code-header"><span>{part.language || 'Code'}</span><CopyButton text={part.text} label="Copy code" /></div><pre><code>{part.text}</code></pre></div>
    : <div className="message-text" key={index}>{part.text}</div>)}</div>;
}

function StepList({ steps }) {
  return <div className="step-list">{steps.map((step, index) => step.kind === 'plan' || step.kind === 'thought'
    ? <details className={'step ' + step.kind} key={`${index}-${!!step.live}`} open={!!step.live}><summary>{step.kind === 'plan' ? 'Plan' : 'Thinking'}{step.live ? ' · live' : ''}</summary><pre>{step.text}</pre></details>
    : <div className={'step ' + step.kind} key={index}><strong>{step.kind === 'command' ? 'Command' : step.kind === 'workspace' ? 'Workspace' : step.kind === 'skill' ? 'Skills' : 'Result'}</strong><pre>{step.text}</pre></div>)}</div>;
}

export default function Conversation({ messages, busy, mode, liveAnswer, steps, elapsed, contextMax, contextUsed, contextApproximate, conversationRef, followBottomRef, onLoadGguf, onSettings }) {
  return <>
    <section className="conversation" aria-label="Conversation" ref={conversationRef} onScroll={event => { const panel = event.currentTarget; followBottomRef.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 96; }}>
      {messages.length ? <div className="message-list">
        {messages.map(item => <div className={'message ' + item.role} key={item.id}>
          {item.role === 'assistant' && <div className="avatar"><Sparkles size={16} /></div>}
          <div className="message-content">
            {item.role === 'assistant' && <div className="message-author">Lite Chat</div>}
            {item.text && (item.role === 'assistant' ? <ResponseBody text={item.text} /> : <div className="message-text">{item.text}</div>)}
            {item.files?.length > 0 && <div className="message-files">{item.files.map(name => <span key={name}><Paperclip size={12} />{name}</span>)}</div>}
            {item.thinking && <details className="thinking-block"><summary>Thinking</summary><pre>{item.thinking}</pre></details>}
            {item.steps && <StepList steps={item.steps} />}
            {item.image && <div className="generated-image"><img src={item.image} alt="Generated artwork" /><a href={item.image} download="local-image.png"><ArrowDownToLine size={16} /> Download</a></div>}
            {item.role === 'assistant' && item.text && <div className="response-actions"><CopyButton text={item.text} label="Copy response" />{item.usage?.used != null && <span title="Actual prompt and output tokens reported by Ollama">Context {item.usage.used.toLocaleString()} / {contextMax.toLocaleString()}</span>}</div>}
          </div>
        </div>)}
        {busy && <div className="message assistant"><div className="avatar"><Sparkles size={16} /></div><div className="message-content"><div className="message-author">{mode === 'image' ? 'Creating image' : mode === 'agent' ? 'Planning and running' : liveAnswer?.content ? 'Writing response' : 'Reading your request'} · {elapsed}s</div>{liveAnswer?.thinking && <details className="thinking-block" open><summary>Thinking</summary><pre>{liveAnswer.thinking}</pre></details>}{liveAnswer?.content ? <div className="message-text">{liveAnswer.content}<span className="live-cursor" /></div> : steps.length ? <StepList steps={steps} /> : <div className="work-indicator"><span /><span /><span /></div>}</div></div>}
      </div> : <div className="welcome"><div className="welcome-icon"><Sparkles size={29} /></div><div className="eyebrow">LOCAL AI WORKSPACE</div><h1>Your ideas, <em>your device.</em></h1><p>Connect Ollama or open a GGUF model to begin.<br />Your chats stay in this browser.</p><div className="start-actions"><button onClick={onLoadGguf}><FolderOpen size={17} /> Load GGUF</button><button onClick={onSettings}><Settings size={17} /> Connect Ollama</button></div></div>}
    </section>
    <div className="context-meter" role="status" aria-label="Context usage"><span>{contextApproximate ? 'Estimated context' : 'Context'} {contextUsed.toLocaleString()} / {contextMax.toLocaleString()} tokens</span><div className="context-meter-track"><div style={{ width: Math.min(100, contextUsed / Math.max(1, contextMax) * 100) + '%' }} /></div></div>
  </>;
}
