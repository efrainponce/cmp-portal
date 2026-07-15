// No "productos propuestos por ventas" data source exists yet — matches the
// design's own empty-state copy exactly rather than fabricating entries.
export function NuevosProductosTab() {
  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
        Ventas aún no ha propuesto productos nuevos para esta oportunidad.
      </div>
    </div>
  );
}
