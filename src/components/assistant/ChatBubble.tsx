// Floating chat bubble — the portal's channel onto the same Claude agent that
// runs the WhatsApp bot (worker/assistant/, sharing worker/lib/assistantTools.ts).
// Lives outside the board switch in App.tsx so it's reachable from any screen.
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useMe } from '../../lib/useMe';
import { getAssistantHistory, sendAssistantMessage, resetAssistant, type AssistantMessage } from '../../lib/apiClient';
import { IconChat, IconSend } from '../icons';

// Claude replies in markdown-lite (**bold**, "- " bullets) — the model's default
// even though the system prompt asks for single-asterisk *negritas*. Render just
// that subset rather than pulling in a full markdown parser for a chat bubble.
function renderInline(text: string, key: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Fragment key={key}>
      {parts.map((part, i) => (part.startsWith('**') && part.endsWith('**')
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>))}
    </Fragment>
  );
}

function renderMessage(text: string): ReactNode {
  return text.split('\n').map((line, i) => {
    const bullet = line.match(/^[-•]\s+(.*)/);
    return (
      <div key={i} style={{ display: 'flex', gap: 6 }}>
        {bullet && <span>•</span>}
        <span>{line ? renderInline(bullet ? bullet[1] : line, String(i)) : ' '}</span>
      </div>
    );
  });
}

interface ChatBubbleProps {
  /** `floating` (default): burbuja + panel flotante de desktop. `dock`: barra
   * fija al pie del shell móvil que abre el chat a pantalla completa —
   * el asistente siempre visible y a un tap para el vendedor con prisa. */
  variant?: 'floating' | 'dock';
}

export function ChatBubble({ variant = 'floating' }: ChatBubbleProps) {
  const docked = variant === 'dock';
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    getAssistantHistory().then((msgs) => { setMessages(msgs); setLoaded(true); }).catch(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, sending]);

  if (!me) return null;

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setSending(true);
    try {
      const reply = await sendAssistantMessage(text);
      setMessages((m) => [...m, { role: 'assistant', text: reply }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: 'Ocurrió un error. Intenta de nuevo en un momento.' }]);
    } finally {
      setSending(false);
    }
  }

  async function reset() {
    await resetAssistant().catch(() => {});
    setMessages([]);
  }

  return (
    <>
      {open && (
        <div style={docked ? {
          // Pantalla completa sobre todo el shell — en un cel el chat es la vista.
          position: 'fixed', inset: 0, height: '100dvh',
          background: 'var(--bg-raised)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1000,
        } : {
          position: 'fixed', bottom: 86, right: 24, width: 360, height: 500, maxHeight: 'calc(100vh - 110px)',
          background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--radius-2xl)',
          boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 1000,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', paddingTop: docked ? 'calc(14px + env(safe-area-inset-top))' : 14,
            borderBottom: '1px solid var(--border)', flex: 'none',
          }}>
            <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>Asistente CMP</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                onClick={reset}
                style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', cursor: 'pointer' }}
                title="Reiniciar conversación"
              >
                Reiniciar
              </span>
              <span onClick={() => setOpen(false)} style={{ color: 'var(--ink-tertiary)', cursor: 'pointer', font: 'var(--text-body-strong)', lineHeight: 1, padding: 6 }}>
                ✕
              </span>
            </div>
          </div>

          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {loaded && messages.length === 0 && (
              <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
                Pregúntame por tu pipeline, oportunidades, proyectos o inventario — o pídeme crear un contacto u oportunidad. ¿En qué te ayudo?
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-sunken)',
                color: m.role === 'user' ? 'var(--ink-on-accent)' : 'var(--ink)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '8px 12px',
                font: 'var(--text-label)',
              }}>
                {renderMessage(m.text)}
              </div>
            ))}
            {sending && (
              <div style={{
                alignSelf: 'flex-start', maxWidth: '85%', background: 'var(--bg-sunken)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '8px 12px', font: 'var(--text-label)', color: 'var(--ink-tertiary)',
              }}>
                Escribiendo…
              </div>
            )}
          </div>

          <div style={{
            display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', flex: 'none',
            paddingBottom: docked ? 'calc(12px + env(safe-area-inset-bottom))' : 12,
          }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Escribe un mensaje…"
              rows={1}
              autoFocus={docked}
              style={{
                flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
                padding: '8px 10px', font: 'var(--text-label)', color: 'var(--ink)', background: 'var(--bg)',
              }}
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              style={{
                flex: 'none', width: 36, height: 36, borderRadius: 'var(--radius-lg)', border: 'none',
                background: 'var(--accent)', color: 'var(--ink-on-accent)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: sending || !input.trim() ? 'default' : 'pointer',
                opacity: sending || !input.trim() ? 0.5 : 1,
              }}
            >
              <IconSend />
            </button>
          </div>
        </div>
      )}

      {docked ? (
        // Barra fija al pie: parece un input de chat listo para escribir — el
        // camino más corto para "pregúntale al asistente" con el cel en la mano.
        <div style={{
          flex: 'none', padding: '10px 12px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
          background: 'var(--bg-raised)', borderTop: '1px solid var(--border)',
        }}>
          <div
            onClick={() => setOpen(true)}
            role="button"
            aria-label="Abrir asistente CMP"
            style={{
              display: 'flex', alignItems: 'center', gap: 10, height: 46, padding: '0 6px 0 14px',
              border: '1.5px solid var(--accent)', borderRadius: 'var(--radius-pill)', background: 'var(--bg)',
              cursor: 'pointer',
            }}
          >
            <IconChat style={{ width: 19, height: 19, color: 'var(--accent)', flex: 'none' }} />
            <div style={{ flex: 1, font: 'var(--text-label)', color: 'var(--ink-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Pregúntale al asistente CMP…
            </div>
            <div style={{
              flex: 'none', width: 36, height: 36, borderRadius: 'var(--radius-full)', background: 'var(--accent)',
              color: 'var(--ink-on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <IconSend />
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            position: 'fixed', bottom: 24, right: 24, width: 48, height: 48, borderRadius: 'var(--radius-full)',
            border: 'none', background: 'var(--accent)', color: 'var(--ink-on-accent)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-modal)', zIndex: 1000,
          }}
          title="Asistente CMP"
        >
          <IconChat style={{ width: 22, height: 22 }} />
        </button>
      )}
    </>
  );
}
