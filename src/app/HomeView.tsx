// Pantalla "Inicio" — saludo + pendientes en tarjetas (no una tabla de Monday),
// pedido por Efraín (2026-08-10) porque compras no entendía el portal. Cada
// rol ve una definición distinta de "pendiente" (worker/lib/home.ts): compras
// = costeo incompleto, vendedor = oportunidades stale a las que dar
// seguimiento, admin = supervisión de ambas.
import { useState } from 'react';
import type { HomePendienteDTO, HomeSectionDTO } from '../lib/homeApi';
import { useHome, enviarSeguimiento } from '../lib/homeApi';
import { useMe } from '../lib/useMe';
import { useIsMobile } from '../lib/useIsMobile';
import { Button } from '../components/core/Button';

interface Props {
  onOpenPendiente: (boardKey: string, itemId: string) => void;
}

function PendienteCard({
  item, showSeguimiento, onOpen,
}: {
  item: HomePendienteDTO;
  showSeguimiento: boolean;
  onOpen: () => void;
}) {
  const [mensaje, setMensaje] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const clean = mensaje.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      await enviarSeguimiento(item.itemId, clean);
      setSent(true);
    } catch {
      setSending(false);
    }
  };

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div
        onClick={onOpen}
        style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{item.title}</div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 2 }}>{item.subtitle}</div>
        </div>
        {item.daysStale > 0 && (
          <span style={{
            flex: 'none', font: 'var(--text-caption)', color: 'var(--ink-tertiary)',
            background: 'var(--bg-sunken)', borderRadius: 'var(--radius-full)', padding: '3px 9px', whiteSpace: 'nowrap',
          }}>
            hace {item.daysStale} d
          </span>
        )}
      </div>

      {showSeguimiento && (
        sent ? (
          <div style={{ font: 'var(--text-caption)', color: 'var(--status-confirmado)' }}>Seguimiento enviado ✓</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="¿Cómo va esta oportunidad?"
              rows={2}
              style={{
                flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
                padding: '6px 9px', font: 'var(--text-caption)', color: 'var(--ink)', background: 'var(--bg)',
                boxSizing: 'border-box',
              }}
            />
            <Button
              variant={mensaje.trim() && !sending ? 'primary' : 'disabled'}
              onClick={submit}
              style={{ padding: '7px 14px', font: 'var(--text-caption)' }}
            >
              {sending ? '…' : 'Enviar'}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

function Section({ section, onOpenPendiente }: { section: HomeSectionDTO; onOpenPendiente: Props['onOpenPendiente'] }) {
  if (section.items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>{section.label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {section.items.map((item) => (
          <PendienteCard
            key={item.itemId}
            item={item}
            showSeguimiento={section.key === 'seguimiento'}
            onOpen={() => onOpenPendiente(item.boardKey, item.itemId)}
          />
        ))}
      </div>
    </div>
  );
}

export function HomeView({ onOpenPendiente }: Props) {
  const { home } = useHome();
  const me = useMe();
  const isMobile = useIsMobile();
  const pad = isMobile ? 16 : 28;

  const totalPendientes = home?.sections.reduce((n, s) => n + s.items.length, 0) ?? 0;

  return (
    <div style={{ height: '100%', overflowY: 'auto', boxSizing: 'border-box', padding: pad }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <div style={{ font: '800 22px \'Inter\', sans-serif', color: 'var(--ink)' }}>
            Hola, {home?.greetingName ?? me?.nombre ?? ''}
          </div>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', marginTop: 4 }}>
            {home === null
              ? 'Cargando…'
              : totalPendientes === 0
                ? 'Sin pendientes por ahora.'
                : `${totalPendientes} pendiente${totalPendientes === 1 ? '' : 's'} por revisar.`}
          </div>
        </div>

        {home?.sections.map((section) => (
          <Section key={section.key} section={section} onOpenPendiente={onOpenPendiente} />
        ))}
      </div>
    </div>
  );
}
