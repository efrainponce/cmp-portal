// Tabs del drawer, en el orden que pidió Efraín (2026-09-21):
//   Actualizaciones, Resumen | Cotizaciones, Inventario, Embellecimientos,
//   Nuevos productos, Actividad | Documentación, Tallas, Órdenes de compra,
//   Ejecución, Logística.
// El último grupo va en píldoras y se abre por etapa (Documentación/Tallas desde
// Costeo Confirmado; el resto desde Esperando OC — ver dealStages.stageAtOrAfter).
import { useIsMobile } from '../../lib/useIsMobile';
import { useCanVerActividad } from '../../lib/useMe';

export type DrawerTabKey =
  | 'actualizaciones' | 'resumen' | 'cotizacion' | 'inventario' | 'embellecimientos' | 'nuevosproductos' | 'muestras' | 'actividad'
  | 'documentacion' | 'tallas' | 'ordenes' | 'ejecucion' | 'logistica';

// Mismas llaves, en runtime: el tercer segmento de la URL (/board/item/tab) se
// valida contra esto antes de abrir el drawer en esa pestaña.
export const DRAWER_TAB_KEYS: DrawerTabKey[] = [
  'actualizaciones', 'resumen', 'cotizacion', 'inventario', 'embellecimientos', 'nuevosproductos', 'muestras', 'actividad',
  'documentacion', 'tallas', 'ordenes', 'ejecucion', 'logistica',
];

export function isDrawerTab(v: string | null | undefined): v is DrawerTabKey {
  return !!v && (DRAWER_TAB_KEYS as string[]).includes(v);
}

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
  { key: 'inventario', label: 'Inventario' },
  { key: 'embellecimientos', label: 'Embellecimientos' },
  { key: 'nuevosproductos', label: 'Nuevos productos' },
  // Solicitudes de muestra de esta oportunidad (Efraín, 2026-09-21).
  { key: 'muestras', label: 'Muestras' },
  { key: 'actividad', label: 'Actividad' },
];

/** Píldoras del Proyecto. `desde` = etapa mínima; el drawer decide con
 * showPostventa (Documentación/Tallas) y showProyectos (el resto). */
const PROYECTO_TABS: { key: DrawerTabKey; label: string; grupo: 'postventa' | 'proyectos' }[] = [
  { key: 'documentacion', label: 'Documentación', grupo: 'postventa' },
  { key: 'tallas', label: 'Tallas', grupo: 'postventa' },
  { key: 'ordenes', label: 'Órdenes de compra', grupo: 'proyectos' },
  { key: 'ejecucion', label: 'Ejecución', grupo: 'proyectos' },
  { key: 'logistica', label: 'Logística', grupo: 'proyectos' },
];

export function BoardTabsBar({ active, onChange, updatesCount = 0, showPostventa = true, showProyectos = true }: Props) {
  const isMobile = useIsMobile();
  // Historial: solo Compras/Admin (shared/visibility.ts canReadActivity, Efraín
  // 2026-08-18). El server ya niega el endpoint con 403 — esto solo evita
  // ofrecerle al vendedor un tab que le va a salir en error.
  const verActividad = useCanVerActividad();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '0 14px' : '0 32px', borderBottom: '1px solid var(--border)', flex: 'none', overflowX: 'auto' }}>
      <UnderlineTab active={active === 'actualizaciones'} onClick={() => onChange('actualizaciones')}>
        <span>Actualizaciones</span>
        {updatesCount > 0 && (
          <span style={{ font: '600 9px var(--font-ui)', color: '#fff', background: 'var(--accent)', padding: '1px 6px', borderRadius: 'var(--radius-pill)' }}>
            {updatesCount}
          </span>
        )}
      </UnderlineTab>
      {showProyectos && (
        <UnderlineTab active={active === 'resumen'} onClick={() => onChange('resumen')}>Resumen</UnderlineTab>
      )}
      <VDivider />
      {UNDERLINE_TABS.filter((t) => t.key !== 'actividad' || verActividad).map((t) => (
        <UnderlineTab key={t.key} active={active === t.key} onClick={() => onChange(t.key)}>{t.label}</UnderlineTab>
      ))}
      {(showPostventa || showProyectos) && (
        <>
          <VDivider />
          <SectionLabel color="#7f8f78">Proyecto</SectionLabel>
          {PROYECTO_TABS.filter((t) => (t.grupo === 'postventa' ? showPostventa : showProyectos)).map((t) => (
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
        display: 'flex', alignItems: 'center', gap: 6, padding: '9px 4px', marginRight: 14,
        font: '500 11.5px var(--font-ui)', cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none',
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
        padding: '6px 10px', marginRight: 6, borderRadius: 7, font: '500 11.5px var(--font-ui)',
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
    <div style={{ font: '600 8.5px var(--font-ui)', color, letterSpacing: '.4px', textTransform: 'uppercase', marginRight: 8, flex: 'none', whiteSpace: 'nowrap' }}>
      {children}
    </div>
  );
}

function VDivider() {
  return <div style={{ width: 1, height: 20, background: 'var(--border)', marginRight: 14, flex: 'none' }} />;
}
