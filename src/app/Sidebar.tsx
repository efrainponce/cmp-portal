import { NavItem } from '../components/navigation/NavItem';
import { UserChip } from './UserChip';
import { useMe } from '../lib/useMe';
import type { Role } from '../../shared/types';
import logo from '../assets/logo.webp';
import {
  IconOportunidades, IconGlobe, IconCosteo, IconValidacion, IconDocTallas, IconOrdenesCompra, IconLogistica,
  IconProductos, IconCuentas, IconClientes, IconInventario, IconCollapse, IconExpand, IconSettings,
} from '../components/icons';

export type BoardKey =
  | 'oportunidades' | 'oportunidades_web' | 'costeo' | 'validacion' | 'doctallas' | 'ordenescompra' | 'logistica'
  | 'productos' | 'instituciones' | 'contactos' | 'proveedores' | 'inventario' | 'settings';

type NavIcon = (p: { style?: React.CSSProperties }) => React.ReactElement;
interface NavItemConfig { key: BoardKey; label: string; icon: NavIcon; roles?: Role[] }

const VENTAS_ITEMS: NavItemConfig[] = [
  { key: 'oportunidades', label: 'Oportunidades', icon: IconOportunidades },
  { key: 'oportunidades_web', label: 'Oportunidades Web', icon: IconGlobe },
  { key: 'costeo', label: 'Costeo', icon: IconCosteo },
  { key: 'validacion', label: 'Validación Costeo', icon: IconValidacion },
];

// Un solo grupo: post-venta es el flujo del Proyecto — subir documentación y
// tallas, generar las órdenes de compra y hacer el fulfillment (Efraín, 2026-07-17).
const PROYECTOS_ITEMS: NavItemConfig[] = [
  { key: 'doctallas', label: 'Documentación y Tallas', icon: IconDocTallas },
  { key: 'ordenescompra', label: 'Órdenes de Compra', icon: IconOrdenesCompra },
  { key: 'logistica', label: 'Logística', icon: IconLogistica },
];

const CATALOG_ITEMS: NavItemConfig[] = [
  { key: 'productos', label: 'Productos', icon: IconProductos },
  { key: 'instituciones', label: 'Instituciones', icon: IconCuentas },
  { key: 'contactos', label: 'Contactos', icon: IconClientes },
  // Solo compras/admin: mismas columnas AC-only que el picker de línea manual
  // del Proyecto (shared/visibility.ts) — para vendedor el board vendría sin
  // columnas visibles (Efraín, 2026-07-17).
  { key: 'proveedores', label: 'Proveedores', icon: IconOrdenesCompra, roles: ['compras', 'admin'] },
];

const INVENTARIO_ITEMS: NavItemConfig[] = [
  { key: 'inventario', label: 'Inventario', icon: IconInventario },
];

/** Label por board para headers fuera del sidebar (p.ej. la barra superior móvil). */
export const BOARD_LABELS: Record<BoardKey, string> = {
  ...Object.fromEntries(
    [...VENTAS_ITEMS, ...PROYECTOS_ITEMS, ...CATALOG_ITEMS, ...INVENTARIO_ITEMS]
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', height: 32 }}>
        <img src={logo} alt="CMP" style={{ width: 28, height: 28, flex: 'none' }} />
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
        {CATALOG_ITEMS.filter((item) => !item.roles || (me?.role && item.roles.includes(me.role))).map((item) => (
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
