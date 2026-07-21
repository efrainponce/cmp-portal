import { NavItem } from '../components/navigation/NavItem';
import { UserChip } from './UserChip';
import { useMe } from '../lib/useMe';
import logo from '../assets/logo.webp';
import {
  IconOportunidades, IconGlobe, IconCosteo, IconValidacion, IconDocTallas, IconOrdenesCompra, IconLogistica,
  IconProductos, IconCuentas, IconClientes, IconInventario, IconChevronLeft, IconChevronRight, IconSettings,
} from '../components/icons';

export type BoardKey =
  | 'oportunidades' | 'oportunidades_web' | 'costeo' | 'validacion' | 'doctallas' | 'ordenescompra' | 'logistica'
  | 'productos' | 'instituciones' | 'contactos' | 'proveedores' | 'inventario' | 'settings';

type NavIcon = (p: { style?: React.CSSProperties }) => React.ReactElement;
interface NavItemConfig { key: BoardKey; label: string; icon: NavIcon }

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
  { key: 'proveedores', label: 'Proveedores', icon: IconOrdenesCompra },
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
  const visible = (items: NavItemConfig[]) => items.filter((item) => me?.boardAccess.includes(item.key));
  const ventasItems = visible(VENTAS_ITEMS);
  const proyectosItems = visible(PROYECTOS_ITEMS);
  const inventarioItems = visible(INVENTARIO_ITEMS);
  const catalogItems = visible(CATALOG_ITEMS);
  return (
    <div style={{
      width: collapsed ? 60 : 220,
      height: '100%',
      minHeight: 0,
      transition: 'var(--transition-collapse)',
      background: 'var(--surface-sidebar)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      flex: 'none',
      boxSizing: 'border-box',
      // relative + z-index: el botón de colapsar flota sobre el borde derecho,
      // encima del panel de contenido (que si no, pinta arriba por ir después en el DOM).
      position: 'relative',
      zIndex: 2,
    }}>
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '16px 10px',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', height: 32 }}>
          <img src={logo} alt="CMP" style={{ width: 28, height: 28, flex: 'none' }} />
          {!collapsed && (
            <div style={{ font: '800 12px \'Inter\', sans-serif', color: 'var(--ink)', letterSpacing: '.2px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              CMP Portal
            </div>
          )}
        </div>

        {ventasItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 26 }}>
            {!collapsed && <SectionLabel>Ventas</SectionLabel>}
            {ventasItems.map((item) => (
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
        )}

        {proyectosItems.length > 0 && (
          <>
            <Divider />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {!collapsed && <SectionLabel color="#7f8f78">Proyectos</SectionLabel>}
              {proyectosItems.map((item) => (
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
          </>
        )}

        {inventarioItems.length > 0 && (
          <>
            <Divider />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {!collapsed && <SectionLabel color="#a9835a">Inventario</SectionLabel>}
              {inventarioItems.map((item) => (
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
          </>
        )}

        {catalogItems.length > 0 && (
          <>
            <Divider />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {!collapsed && <SectionLabel>Catálogos</SectionLabel>}
              {catalogItems.map((item) => (
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
          </>
        )}

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
        </div>
      </div>

      {!hideCollapse && (
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
          aria-label={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
          style={{
            position: 'absolute',
            top: 20,
            right: -11,
            width: 22,
            height: 22,
            flex: 'none',
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: 'var(--surface-sidebar)',
            color: 'var(--ink-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,.15)',
            padding: 0,
          }}
        >
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
        </button>
      )}
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ font: '700 8.5px \'Inter\', sans-serif', color: color ?? 'var(--ink-quiet)', letterSpacing: '.5px', textTransform: 'uppercase', padding: '0 10px 6px' }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '10px 10px 8px' }} />;
}
