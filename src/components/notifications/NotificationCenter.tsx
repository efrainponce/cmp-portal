// Contenido del centro de notificaciones — compartido entre el popover de
// desktop y la hoja de pantalla completa de móvil (NotificationBell decide el
// contenedor). Dos bandejas por severity, cada fila navega al deep link de
// la oportunidad (boardKey/itemId) igual que src/lib/routing.ts.
import { useMemo, useState } from 'react';
import type { NotificationDTO } from '../../../shared/dto';
import { Tabs } from '../navigation/Tabs';

interface NotificationCenterProps {
  notifications: NotificationDTO[];
  unread: { importante: number; actualizacion: number };
  onNavigate: (boardKey: string, itemId: string | null) => void;
  onClose: () => void;
  markRead: (id: number) => Promise<void>;
  markAllRead: (filter?: 'importante' | 'actualizacion') => Promise<void>;
  /** Móvil: agrega un header propio con título + botón cerrar y safe-area-inset-top. */
  mobileHeader?: boolean;
}

type Severity = 'importante' | 'actualizacion';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.round(hrs / 24);
  return `Hace ${days} d`;
}

// Punto de color + letra por kind — evita depender de fuentes de emoji y da
// una señal visual consistente con los acentos ya usados en el resto del portal.
function KindBadge({ kind }: { kind: string }) {
  const cfg: Record<string, { letter: string; color: string }> = {
    mention: { letter: '@', color: 'var(--accent-blue)' },
    costeo_incompleto: { letter: '!', color: 'var(--status-esperando)' },
    stage_change: { letter: '→', color: 'var(--status-confirmado)' },
  };
  const { letter, color } = cfg[kind] ?? { letter: '•', color: 'var(--ink-quiet)' };
  return (
    <div style={{
      width: 26, height: 26, borderRadius: 'var(--radius-full)', background: color, opacity: 0.9,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: '700 12px \'Inter\', sans-serif', flex: 'none',
    }}>
      {letter}
    </div>
  );
}

function NotificationRow({ n, onClick }: { n: NotificationDTO; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', gap: 10, padding: '10px 14px', cursor: 'pointer',
        background: n.read ? 'transparent' : 'var(--bg-sunken)',
        borderLeft: n.read ? '2px solid transparent' : '2px solid var(--accent)',
      }}
    >
      <KindBadge kind={n.kind} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>{n.title}</div>
        {n.body && (
          <div style={{
            font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 2,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {n.body}
          </div>
        )}
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 4 }}>
          {[n.actor, fmtWhen(n.createdAt)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}

export function NotificationCenter({
  notifications, unread, onNavigate, onClose, markRead, markAllRead, mobileHeader,
}: NotificationCenterProps) {
  const [tab, setTab] = useState<Severity>(() => {
    if (unread.importante > 0) return 'importante';
    if (unread.actualizacion > 0) return 'actualizacion';
    return 'importante';
  });

  const filtered = useMemo(
    () => notifications.filter((n) => n.severity === tab),
    [notifications, tab],
  );
  const activeUnread = unread[tab];

  const handleRowClick = async (n: NotificationDTO) => {
    if (!n.read) await markRead(n.id).catch(() => {});
    if (n.itemId) onNavigate(n.boardKey ?? 'oportunidades', n.itemId);
    onClose();
  };

  return (
    <>
      {mobileHeader && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', paddingTop: 'calc(14px + env(safe-area-inset-top))',
          borderBottom: '1px solid var(--border)', flex: 'none',
        }}>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>Notificaciones</div>
          <span
            onClick={onClose}
            style={{ color: 'var(--ink-tertiary)', cursor: 'pointer', font: 'var(--text-body-strong)', lineHeight: 1, padding: 6 }}
          >
            ✕
          </span>
        </div>
      )}

      <div style={{ padding: '10px 14px 0', flex: 'none' }}>
        <Tabs
          tabs={[
            { key: 'importante', label: unread.importante > 0 ? `Importantes (${unread.importante})` : 'Importantes' },
            { key: 'actualizacion', label: unread.actualizacion > 0 ? `Actualizaciones (${unread.actualizacion})` : 'Actualizaciones' },
          ]}
          activeKey={tab}
          onChange={(k) => setTab(k as Severity)}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 14px', flex: 'none' }}>
        <span
          onClick={activeUnread > 0 ? () => markAllRead(tab) : undefined}
          style={{
            font: 'var(--text-caption)', cursor: activeUnread > 0 ? 'pointer' : 'default',
            color: activeUnread > 0 ? 'var(--accent)' : 'var(--ink-faint)',
          }}
        >
          Marcar todo como leído
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {filtered.length === 0 && (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-faint)', padding: '24px 14px', textAlign: 'center' }}>
            Sin notificaciones
          </div>
        )}
        {filtered.map((n) => (
          <NotificationRow key={n.id} n={n} onClick={() => handleRowClick(n)} />
        ))}
      </div>
    </>
  );
}
