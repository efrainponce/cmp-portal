import { NavItem } from '../components/navigation/NavItem';
import { UserChip } from './UserChip';
import { useMe } from '../lib/useMe';
import {
  IconOportunidades, IconCosteo, IconValidacion, IconDocTallas, IconOrdenesCompra, IconLogistica,
  IconProductos, IconCuentas, IconClientes, IconInventario, IconCollapse, IconExpand, IconSettings,
} from '../components/icons';

export type BoardKey =
  | 'oportunidades' | 'costeo' | 'validacion' | 'doctallas' | 'ordenescompra' | 'logistica'
  | 'productos' | 'instituciones' | 'contactos' | 'inventario' | 'settings';

type NavIcon = (p: { style?: React.CSSProperties }) => React.ReactElement;

const VENTAS_ITEMS: { key: BoardKey; label: string; icon: NavIcon }[] = [
  { key: 'oportunidades', label: 'Oportunidades', icon: IconOportunidades },
  { key: 'costeo', label: 'Costeo', icon: IconCosteo },
  { key: 'validacion', label: 'Validación Costeo', icon: IconValidacion },
];

const POSTVENTA_ITEMS: { key: BoardKey; label: string; icon: NavIcon }[] = [
  { key: 'doctallas', label: 'Documentación y Tallas', icon: IconDocTallas },
];

const PROYECTOS_ITEMS: { key: BoardKey; label: string; icon: NavIcon }[] = [
  { key: 'ordenescompra', label: 'Órdenes de Compra', icon: IconOrdenesCompra },
  { key: 'logistica', label: 'Logística', icon: IconLogistica },
];

const CATALOG_ITEMS: { key: BoardKey; label: string; icon: NavIcon }[] = [
  { key: 'productos', label: 'Productos', icon: IconProductos },
  { key: 'instituciones', label: 'Instituciones', icon: IconCuentas },
  { key: 'contactos', label: 'Contactos', icon: IconClientes },
];

const INVENTARIO_ITEMS: { key: BoardKey; label: string; icon: NavIcon }[] = [
  { key: 'inventario', label: 'Inventario', icon: IconInventario },
];

/** Label por board para headers fuera del sidebar (p.ej. la barra superior móvil). */
export const BOARD_LABELS: Record<BoardKey, string> = {
  ...Object.fromEntries(
    [...VENTAS_ITEMS, ...POSTVENTA_ITEMS, ...PROYECTOS_ITEMS, ...CATALOG_ITEMS, ...INVENTARIO_ITEMS]
      .map((i) => [i.key, i.label]),
  ),
  settings: 'Configuración',
} as Record<BoardKey, string>;

interface SidebarProps {
  activeBoard: BoardKey;
  onSelectBoard: (key: BoardKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** En móvil el sidebar vive dentro de un menú deslizante — sin botón de colapsar. */
  hideCollapse?: boolean;
}

export function Sidebar({ activeBoard, onSelectBoard, collapsed, onToggleCollapsed, hideCollapse }: SidebarProps) {
  const me = useMe();
  return (
    <div style={{
      width: collapsed ? 60 : 220,
      transition: 'var(--transition-collapse)',
      background: 'var(--surface-sidebar)',
      borderRight: '1px solid var(--border)',
      padding: '16px 10px',
      display: 'flex',
      flexDirection: 'column',
      flex: 'none',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 8px', height: 22 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--ink)', flex: 'none' }} />
        {!collapsed && (
          <div style={{ font: '800 14px \'Inter\', sans-serif', color: 'var(--ink)', letterSpacing: '.2px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            CMP Portal
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 26 }}>
        {!collapsed && <SectionLabel>Ventas</SectionLabel>}
        {VENTAS_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            icon={<item.icon />}
            label={item.label}
            active={activeBoard === item.key}
            collapsed={collapsed}
            onClick={() => onSelectBoard(item.key)}
          />
        ))}
      </div>

      <Divider />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!collapsed && <SectionLabel color="#8a9f7e">Postventa</SectionLabel>}
        {POSTVENTA_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            icon={<item.icon />}
            label={item.label}
            active={activeBoard === item.key}
            collapsed={collapsed}
            onClick={() => onSelectBoard(item.key)}
          />
        ))}
      </div>

      <Divider />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!collapsed && <SectionLabel color="#7f8f78">Proyectos</SectionLabel>}
        {PROYECTOS_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            icon={<item.icon />}
            label={item.label}
            active={activeBoard === item.key}
            collapsed={collapsed}
            onClick={() => onSelectBoard(item.key)}
          />
        ))}
      </div>

      <Divider />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!collapsed && <SectionLabel color="#a9835a">Inventario</SectionLabel>}
        {INVENTARIO_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            icon={<item.icon />}
            label={item.label}
            active={activeBoard === item.key}
            collapsed={collapsed}
            onClick={() => onSelectBoard(item.key)}
          />
        ))}
      </div>

      <Divider />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!collapsed && <SectionLabel>Catálogos</SectionLabel>}
        {CATALOG_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            icon={<item.icon />}
            label={item.label}
            active={activeBoard === item.key}
            collapsed={collapsed}
            onClick={() => onSelectBoard(item.key)}
          />
        ))}
      </div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {me?.role === 'admin' && (
          <NavItem
            icon={<IconSettings />}
            label="Configuración"
            active={activeBoard === 'settings'}
            collapsed={collapsed}
            onClick={() => onSelectBoard('settings')}
          />
        )}
        <UserChip collapsed={collapsed} />
        {!hideCollapse && <div
          className="nav-item"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
          style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 'var(--radius-lg)', cursor: 'pointer' }}
        >
          <div style={{ width: 18, height: 18, flex: 'none', color: '#877f6f', display: 'flex' }}>
            {collapsed ? <IconExpand /> : <IconCollapse />}
          </div>
          {!collapsed && (
            <div style={{ font: '600 13px \'Inter\', sans-serif', color: 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>
              Colapsar barra lateral
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ font: '700 10px \'Inter\', sans-serif', color: color ?? 'var(--ink-quiet)', letterSpacing: '.6px', textTransform: 'uppercase', padding: '0 10px 6px' }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '10px 10px 8px' }} />;
}
