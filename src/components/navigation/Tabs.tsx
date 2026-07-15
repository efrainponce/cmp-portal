export interface TabDef {
  key: string;
  label: string;
}

interface TabsProps {
  tabs: TabDef[];
  activeKey: string;
  onChange: (key: string) => void;
  accentColor?: string;
}

/** Segmented tab row with a bottom accent border on the active tab (used for Cotización / Tallas / Documentación etc). */
export function Tabs({ tabs, activeKey, onChange, accentColor = 'var(--accent)' }: TabsProps) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
      {tabs.map((t) => {
        const active = t.key === activeKey;
        return (
          <div
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              padding: '10px 14px', cursor: 'pointer',
              font: active ? 'var(--text-label-strong)' : 'var(--text-label)',
              color: active ? 'var(--ink)' : 'var(--ink-quiet)',
              borderBottom: '2px solid ' + (active ? accentColor : 'transparent'),
              background: active ? 'var(--status-ganada-tint)' : 'transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </div>
        );
      })}
    </div>
  );
}
