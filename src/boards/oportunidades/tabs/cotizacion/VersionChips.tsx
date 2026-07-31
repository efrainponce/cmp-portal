import type { QuoteVersionDTO } from '../../../../lib/api';

/** Chips V1/V2… — vigente resaltada. Seleccionar una anterior muestra su
 * instantánea (solo lectura, sin fórmulas: esas solo existen para la vigente).
 * "+ Nueva versión" junto a la vigente DUPLICA la cotización tal cual (archiva
 * la actual, la copia queda editable inline como en Nueva oportunidad) — nada
 * de draft editor; regresarla a costeo es el botón "Mandar a costeo" del
 * drawer, que se reactiva justo porque la copia está sin costear (Efraín,
 * 2026-07-17). El chip se oculta cuando la vigente ya es un borrador.
 *
 * Los ajustes de "Ajustar línea" (Efraín, 2026-07-31) sobre la vigente se
 * muestran como chips chicos ".1 .2…" al lado — NO son versiones reales (no
 * pasan por costeo), solo trazabilidad de que hubo retoques; por eso van más
 * discretos y sin acción de click (el ajuste es de una línea, no de toda la
 * cotización — el tooltip basta). */
export function VersionChips({
  versions, selected, onSelect, onNuevaVersion,
}: {
  versions: QuoteVersionDTO[]; selected: number | null; onSelect: (id: number | null) => void;
  onNuevaVersion?: () => void;
}) {
  if (versions.length === 0) return null;
  const vigente = versions.find((v) => v.status === 'vigente');
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      {versions.map((v) => {
        const isSelected = selected === null ? v.status === 'vigente' : selected === v.id;
        return (
          <div
            key={v.id}
            onClick={() => onSelect(v.status === 'vigente' ? null : v.id)}
            title={v.status === 'vigente' ? 'Vigente' : `Superada — ${v.createdAt}`}
            style={{
              cursor: 'pointer', font: 'var(--text-label-strong)', padding: '4px 12px',
              borderRadius: 'var(--radius-pill)',
              background: isSelected ? '#2b2925' : 'var(--bg-sunken)',
              color: isSelected ? '#fff' : 'var(--ink-secondary)',
            }}
          >
            {v.label}{v.status === 'vigente' ? ' · vigente' : ''}
          </div>
        );
      })}
      {vigente?.ajustes?.map((a) => (
        <div
          key={a.subversion}
          title={`${a.resumen} — ${a.viewerEmail}, ${a.createdAt}`}
          style={{
            font: 'var(--text-caption)', padding: '3px 8px',
            borderRadius: 'var(--radius-pill)', background: 'transparent',
            color: 'var(--ink-tertiary)', border: '1px dashed var(--border)',
          }}
        >
          .{a.subversion}
        </div>
      ))}
      {onNuevaVersion && (
        <div
          onClick={onNuevaVersion}
          title="Duplica la cotización vigente como una nueva versión editable — la anterior queda archivada"
          style={{
            cursor: 'pointer', font: 'var(--text-label-strong)', padding: '4px 12px',
            borderRadius: 'var(--radius-pill)', border: '1px dashed var(--border)',
            color: 'var(--accent)', background: 'transparent',
          }}
        >
          + Nueva versión
        </div>
      )}
    </div>
  );
}
