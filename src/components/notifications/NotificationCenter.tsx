// Contenido del centro de notificaciones — compartido entre el popover de
// desktop y la hoja de pantalla completa de móvil (NotificationBell decide el
// contenedor). Dos bandejas por severity. Dentro de cada una, los avisos van
// AGRUPADOS por oportunidad/proyecto (agrupar.ts): un renglón por item con sus
// últimos avisos, el clic abre el item (directo en Actualizaciones si lo
// pendiente es un comentario) y marca TODO el grupo como leído.
import { useMemo, useState } from 'react';
import type { NotificationDTO } from '../../../shared/dto';
import { Tabs } from '../navigation/Tabs';
import { agruparNotificaciones, resumenNotif, tabDeGrupo, type GrupoNotif } from './agrupar';

interface NotificationCenterProps {
  notifications: NotificationDTO[];
  unread: { importante: number; actualizacion: number };
  onNavigate: (boardKey: string, itemId: string | null, tab?: string | null) => void;
  onClose: () => void;
  markRead: (id: number) => Promise<void>;
  markItemRead: (itemId: string, severity: Severity) => Promise<void>;
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
function KindBadge({ kind, size = 26 }: { kind: string; size?: number }) {
  const cfg: Record<string, { letter: string; color: string }> = {
    mention: { letter: '@', color: 'var(--accent-blue)' },
    // Comentario de un compañero (dentro del portal o de monday.com), 2026-08-18.
    update_comment: { letter: '”', color: 'var(--accent)' },
    costeo_incompleto: { letter: '!', color: 'var(--status-esperando)' },
    // Aviso retirado el 2026-09-28 (ahora es warning en la línea); se queda
    // para pintar bien los que ya se mandaron.
    costo_sin_airtable: { letter: '$', color: 'var(--status-perdida)' },
    stage_change: { letter: '→', color: 'var(--status-confirmado)' },
    project_status_change: { letter: '→', color: 'var(--status-confirmado)' },
  };
  const { letter, color } = cfg[kind] ?? { letter: '•', color: 'var(--ink-quiet)' };
  return (
    <div style={{
      width: size, height: size, borderRadius: 'var(--radius-full)', background: color, opacity: 0.9,
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: `600 ${size >= 24 ? 12 : 9.5}px var(--font-ui)`, flex: 'none',
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
        {n.link && (
          <div style={{ font: 'var(--text-caption)', color: 'var(--accent-blue)', marginTop: 2 }}>
            Abrir en Airtable ↗
          </div>
        )}
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 4 }}>
          {[n.actor, fmtWhen(n.createdAt)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}

/** Cuántos avisos se listan dentro de un grupo antes del "+N más". */
const MAX_EN_GRUPO = 3;

function GrupoRow({ g, onClick, onMarcar }: { g: GrupoNotif; onClick: () => void; onMarcar: () => void }) {
  const pendiente = g.unread > 0;
  // Primero lo pendiente; si ya está todo leído, lo más reciente.
  const lista = pendiente ? g.notifs.filter((n) => !n.read) : g.notifs;
  const visibles = lista.slice(0, MAX_EN_GRUPO);
  const resto = lista.length - visibles.length;
  return (
    <div
      onClick={onClick}
      className="notif-row"
      style={{
        padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
        background: pendiente ? 'var(--bg-sunken)' : 'transparent',
        borderLeft: pendiente ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          font: pendiente ? 'var(--text-label-strong)' : 'var(--text-label)', color: 'var(--ink)',
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={g.nombre}>
          {g.nombre}
        </div>
        <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', flex: 'none' }}>{fmtWhen(g.notifs[0].createdAt)}</span>
        {pendiente && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMarcar(); }}
            title="Marcar como leído sin abrir"
            aria-label={`Marcar como leído: ${g.nombre}`}
            className="notif-check-btn"
            style={{
              flex: 'none', height: 20, minWidth: 20, padding: '0 6px', borderRadius: 'var(--radius-pill)', border: 'none',
              color: '#fff', font: '600 9.5px var(--font-ui)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}
          >
            {g.unread} ✓
          </button>
        )}
      </div>
      {visibles.map((n) => (
        <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 5 }}>
          <KindBadge kind={n.kind} size={16} />
          <div style={{
            font: 'var(--text-caption)', color: n.read ? 'var(--ink-tertiary)' : 'var(--ink-secondary)', flex: 1, minWidth: 0,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {resumenNotif(n, g.nombre)}
          </div>
        </div>
      ))}
      {resto > 0 && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', margin: '4px 0 0 23px' }}>+ {resto} más</div>
      )}
    </div>
  );
}

export function NotificationCenter({
  notifications, unread, onNavigate, onClose, markRead, markItemRead, markAllRead, mobileHeader,
}: NotificationCenterProps) {
  const [tab, setTab] = useState<Severity>(() => {
    if (unread.importante > 0) return 'importante';
    if (unread.actualizacion > 0) return 'actualizacion';
    return 'importante';
  });

  const grupos = useMemo(
    () => agruparNotificaciones(notifications.filter((n) => n.severity === tab)),
    [notifications, tab],
  );
  const activeUnread = unread[tab];

  const handleRowClick = async (n: NotificationDTO) => {
    // Link externo (Airtable): se abre ANTES del await para que el navegador no
    // lo trate como popup sin gesto del usuario.
    if (n.link) window.open(n.link, '_blank', 'noopener');
    if (!n.read) await markRead(n.id).catch(() => {});
    if (n.link) { onClose(); return; }
    if (n.itemId) onNavigate(n.boardKey ?? 'oportunidades', n.itemId);
    onClose();
  };

  const handleGrupoClick = (g: GrupoNotif) => {
    if (!g.itemId) { handleRowClick(g.notifs[0]); return; }
    // Sin await: abrir el item no espera a la escritura del "leído".
    if (g.unread > 0) markItemRead(g.itemId, tab).catch(() => {});
    onNavigate(g.boardKey ?? 'oportunidades', g.itemId, tabDeGrupo(g));
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

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '10px 14px 0', flex: 'none', borderBottom: '1px solid var(--border)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Tabs
            tabs={[
              { key: 'importante', label: unread.importante > 0 ? `Importantes (${unread.importante})` : 'Importantes' },
              { key: 'actualizacion', label: unread.actualizacion > 0 ? `Cambios de etapa (${unread.actualizacion})` : 'Cambios de etapa' },
            ]}
            activeKey={tab}
            onChange={(k) => setTab(k as Severity)}
          />
        </div>
        {activeUnread > 0 && (
          <button
            type="button"
            onClick={() => markAllRead(tab)}
            style={{
              flex: 'none', marginBottom: 8, border: 'none', background: 'none', padding: 0, cursor: 'pointer',
              font: 'var(--text-caption)', color: 'var(--accent)', whiteSpace: 'nowrap',
            }}
          >
            Marcar todo leído
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {grupos.length === 0 && (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-faint)', padding: '24px 14px', textAlign: 'center' }}>
            Sin notificaciones
          </div>
        )}
        {grupos.map((g) => (g.itemId
          ? <GrupoRow key={g.key} g={g} onClick={() => handleGrupoClick(g)} onMarcar={() => { markItemRead(g.itemId!, tab).catch(() => {}); }} />
          : <NotificationRow key={g.key} n={g.notifs[0]} onClick={() => handleRowClick(g.notifs[0])} />
        ))}
      </div>
    </>
  );
}
