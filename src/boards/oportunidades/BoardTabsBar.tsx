// Matches the design's "Board Tabs" component: underlined Ventas-side tabs
// (Actualizaciones/Cotizaciones/Embellecimientos/Nuevos productos) + two
// pill-style grouped sections (Postventa: Documentación/Tallas · Proyectos:
// Órdenes de compra/Logística), separated by hairline dividers.
export type DrawerTabKey =
  | 'actualizaciones' | 'cotizacion' | 'embellecimientos' | 'nuevosproductos'
  | 'documentacion' | 'tallas' | 'ordenes' | 'logistica';

interface Props {
  active: DrawerTabKey;
  onChange: (tab: DrawerTabKey) => void;
  updatesCount?: number;
  /** Gates the Postventa/Proyectos pill sections by deal_stage — see dealStages.stageAtOrAfter. */
  showPostventa?: boolean;
  showProyectos?: boolean;
}

const UNDERLINE_TABS: { key: DrawerTabKey; label: string }[] = [
  { key: 'cotizacion', label: 'Cotizaciones' },
  { key: 'embellecimientos', label: 'Embellecimientos' },
  { key: 'nuevosproductos', label: 'Nuevos productos' },
];

const POSTVENTA_TABS: { key: DrawerTabKey; label: string }[] = [
  { key: 'documentacion', label: 'Documentación' },
  { key: 'tallas', label: 'Tallas' },
];

const PROYECTOS_TABS: { key: DrawerTabKey; label: string }[] = [
  { key: 'ordenes', label: 'Órdenes de compra' },
  { key: 'logistica', label: 'Logística' },
];

export function BoardTabsBar({ active, onChange, updatesCount = 0, showPostventa = true, showProyectos = true }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 32px', borderBottom: '1px solid var(--border)', flex: 'none', overflowX: 'auto' }}>
      <UnderlineTab active={active === 'actualizaciones'} onClick={() => onChange('actualizaciones')}>
        <span>Actualizaciones</span>
        {updatesCount > 0 && (
          <span style={{ font: '700 10px \'Inter\', sans-serif', color: '#fff', background: 'var(--accent)', padding: '1px 6px', borderRadius: 'var(--radius-pill)' }}>
            {updatesCount}
          </span>
        )}
      </UnderlineTab>
      <VDivider />
      {UNDERLINE_TABS.map((t) => (
        <UnderlineTab key={t.key} active={active === t.key} onClick={() => onChange(t.key)}>{t.label}</UnderlineTab>
      ))}
      {showPostventa && (
        <>
          <VDivider />
          <SectionLabel color="#8a9f7e">Postventa</SectionLabel>
          {POSTVENTA_TABS.map((t) => (
            <PillTab key={t.key} active={active === t.key} onClick={() => onChange(t.key)}>{t.label}</PillTab>
          ))}
        </>
      )}
      {showProyectos && (
        <>
          <VDivider />
          <SectionLabel color="#7f8f78">Proyectos</SectionLabel>
          {PROYECTOS_TABS.map((t) => (
            <PillTab key={t.key} active={active === t.key} onClick={() => onChange(t.key)}>{t.label}</PillTab>
          ))}
        </>
      )}
    </div>
  );
}

function UnderlineTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '12px 4px', marginRight: 14,
        font: '600 13px \'Inter\', sans-serif', cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none',
        color: active ? 'var(--ink)' : 'var(--ink-quiet)',
        borderBottom: '2px solid ' + (active ? 'var(--accent)' : 'transparent'),
      }}
    >
      {children}
    </div>
  );
}

function PillTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 12px', marginRight: 6, borderRadius: 7, font: '600 13px \'Inter\', sans-serif',
        cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none',
        color: active ? 'var(--ink)' : 'var(--ink-quiet)',
        background: active ? 'var(--status-ganada-tint)' : 'transparent',
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <div style={{ font: '700 9.5px \'Inter\', sans-serif', color, letterSpacing: '.4px', textTransform: 'uppercase', marginRight: 8, flex: 'none', whiteSpace: 'nowrap' }}>
      {children}
    </div>
  );
}

function VDivider() {
  return <div style={{ width: 1, height: 20, background: 'var(--border)', marginRight: 14, flex: 'none' }} />;
}
