import React, { useState, useRef, useEffect } from 'react';
import { useProject } from '../project.jsx';

/**
 * Schwebender KI-Chat. Stellt Fragen an /api/chat mit dem aktuellen Zeitraum.
 * range = { from, to } wird mitgeschickt, damit Antworten zum gewählten
 * Zeitraum passen.
 */
export default function ChatBot({ range }) {
  const { features } = useProject();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Beispielfrage passend zu den aktiven Features
  const [msgs, setMsgs] = useState(() => [
    {
      role: 'assistant',
      content: features.hasQuality
        ? 'Hi! Frag mich z. B. „Wie ist die Lead-Qualität heute?" oder „Welches Creative bringt den günstigsten CPL?"'
        : 'Hi! Frag mich z. B. „Welche Kampagne bringt die meisten Leads?" oder „Welches Creative hat den günstigsten CPL?"',
    },
  ]);
  const bodyRef = useRef(null);

  useEffect(() => {
    fetch('/api/chat/health').then((r) => r.json()).then((d) => setAvailable(Boolean(d.configured))).catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, open, busy]);

  if (available === false) return null; // kein API-Key -> Widget ausblenden

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.filter((m) => m.role !== 'system'), from: range.from, to: range.to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsgs((m) => [...m, { role: 'assistant', content: data.answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <>
      <button className={`chat-fab ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)} title="Analyse-Assistent" aria-label="Chat öffnen">
        {open ? '✕' : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        )}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-head">
            <span className="chat-title">Analyse-Assistent</span>
            <span className="chat-sub">{range.from ? `${range.from} – ${range.to}` : 'Maximum'}</span>
          </div>
          <div className="chat-body" ref={bodyRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>{m.content}</div>
            ))}
            {busy && <div className="chat-msg assistant chat-typing"><span></span><span></span><span></span></div>}
          </div>
          <div className="chat-input">
            <textarea
              rows={1}
              value={input}
              placeholder={features.hasQuality ? 'Frage zu Leads, Kampagnen, Qualität…' : 'Frage zu Leads und Kampagnen…'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
            />
            <button className="refresh-btn" onClick={send} disabled={busy || !input.trim()}>Senden</button>
          </div>
        </div>
      )}
    </>
  );
}
