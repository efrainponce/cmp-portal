// src/boards/oportunidades/EtapaAdminSelect.tsx — la etapa como control, no
// como etiqueta. SOLO admin (Efraín, 2026-08-20).
//
// Hasta ahora la etapa solo se movía por los botones del flujo (Mandar a
// costeo → Validar costeo → Generar cotización → Ganar/Perder/Cancelar), y cada
// uno aparece nada más en la etapa exacta que lo habilita. Cuando una
// oportunidad quedaba en una etapa que no le tocaba —el 2026-08-20 OPP-0933
// llegó a "Costeo Confirmado" y luego a "Cotización" sin un solo precio,
// porque los botones de Monday.com no validan nada— no había forma de
// regresarla desde el portal: había que ir a Monday.
//
// Se pinta con el mismo chip de siempre para que a simple vista nada cambie:
// es un `<select>` nativo (también en cel, 390px) vestido de StatusBadge.
import type { CSSProperties } from 'react';
import { DEAL_STAGE_LABELS, DEAL_STAGE_ORDER } from '../../../shared/dealStages';

interface Props {
  /** Índice de la etapa actual ('4', '15', …) tal como lo da statusIndex. */
  stage: string;
  color: string;
  tint: string;
  busy?: boolean;
  onChange: (idx: string) => void;
}

const chip: CSSProperties = {
  font: 'var(--text-chip)', padding: '3px 26px 3px 9px', borderRadius: 'var(--radius-pill)',
  width: 'fit-content', maxWidth: '100%', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  border: 'none', appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
};

export function EtapaAdminSelect({ stage, color, tint, busy, onChange }: Props) {
  return (
    // `alignSelf`/`width` explícitos: en cel el header se apila con
    // `alignItems: stretch` y sin esto el chip se estiraba de lado a lado de la
    // pantalla, con la flechita perdida hasta la orilla derecha.
    <span style={{
      position: 'relative', display: 'inline-flex', alignItems: 'center',
      alignSelf: 'flex-start', width: 'fit-content', maxWidth: '100%',
      opacity: busy ? 0.6 : 1,
    }}>
      <select
        value={stage}
        disabled={busy}
        onChange={(e) => { const idx = e.target.value; if (idx !== stage) onChange(idx); }}
        title="Cambiar la etapa a mano (solo admin). Escribe la etapa en Monday tal cual; NO dispara los PDFs ni los avisos del flujo."
        style={{ ...chip, color, background: tint, cursor: busy ? 'default' : 'pointer' }}
      >
        {DEAL_STAGE_ORDER.map((idx) => (
          <option key={idx} value={idx}>{DEAL_STAGE_LABELS[idx]}</option>
        ))}
      </select>
      {/* Flechita propia: el `appearance: none` que necesita el chip se lleva
          también la del navegador, y sin ninguna señal el chip no se lee como
          algo que se pueda tocar. */}
      <span aria-hidden style={{
        position: 'absolute', right: 9, pointerEvents: 'none',
        font: 'var(--text-caption)', color, opacity: 0.8, lineHeight: 1,
      }}>▾</span>
    </span>
  );
}
