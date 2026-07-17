import type { QuoteVersionDTO } from '../../../../lib/api';

/** Chips V1/V2… — vigente resaltada. Seleccionar una anterior muestra su
 * instantánea (solo lectura, sin fórmulas: esas solo existen para la vigente).
 * "+ Nueva versión" junto a la vigente abre el draft — solo guarda la versión;
 * regresarla a costeo es el botón "Mandar a costeo" del drawer, que se reactiva
 * justo porque existe una versión nueva sin costear (Efraín, 2026-07-17). */
export function VersionChips({
  versions, selected, onSelect, onNuevaVersion,
}: {
  versions: QuoteVersionDTO[]; selected: number | null; onSelect: (id: number | null) => void;
  onNuevaVersion?: () => void;
}) {
  if (versions.length === 0) return null;
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
