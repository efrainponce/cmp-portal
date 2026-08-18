import { NavItem } from '../components/navigation/NavItem';
import { NotificationBell } from '../components/notifications/NotificationBell';
import { UserChip } from './UserChip';
import { useMe } from '../lib/useMe';
import { useAnuncios } from '../lib/anunciosApi';
// 64x64, no el de 256: se pinta a 28 px y el grande eran 15.8 KB en la ventana
// crítica de carga. Al pesar <4 KB, Vite lo mete inline como data URI y
// además desaparece el request. El de 256 se queda para favicon/apple-touch
// (index.html), donde sí se necesita grande.
import logo from '../assets/logo-64.webp';
import {
  IconHome, IconOportunidades, IconGlobe, IconCosteo, IconValidacion, IconDocTallas, IconOrdenesCompra, IconEjecucion, IconLogistica,
  IconProductos, IconCuentas, IconClientes, IconInventario, IconChevronLeft, IconChevronRight, IconSettings, IconLock,
  IconAnuncios, IconAnalisis,
} from '../components/icons';

export type BoardKey =
  | 'home' | 'anuncios'
  | 'oportunidades' | 'oportunidades_web' | 'costeo' | 'validacion' | 'doctallas' | 'ordenescompra' | 'ejecucion' | 'logistica'
  | 'productos' | 'instituciones' | 'contactos' | 'proveedores' | 'inventario' | 'settings' | 'analisis'
  | 'zona_efrain';

type NavIcon = (p: { style?: React.CSSProperties }) => React.ReactElement;
interface NavItemConfig { key: BoardKey; label: string; icon: NavIcon }

const VENTAS_ITEMS: NavItemConfig[] = [
  { key: 'oportunidades', label: 'Oportunidades', icon: IconOportunidades },
  { key: 'oportunidades_web', label: 'Oportunidades Web', icon: IconGlobe },
  { key: 'costeo', label: 'Costeo', icon: IconCosteo },
  { key: 'validacion', label: 'Validación Costeo', icon: IconValidacion },
];

// Zona privada "Efrain" (worker/lib/zonas.ts, Efraín 2026-08-12): NO vive en
// shared/boardAccess.ts porque esa matriz es por ROL (admin siempre ve todo
// ahí) — este tab es por-USUARIO (me.zonaEfrainAccess, la misma whitelist de 3
// personas del backend), así que se agrega aparte, condicionalmente, abajo.
const ZONA_EFRAIN_ITEM: NavItemConfig = { key: 'zona_efrain', label: 'Zona Efrain', icon: IconLock };

// Un solo grupo: post-venta es el flujo del Proyecto — subir documentación y
// tallas, generar las órdenes de compra y hacer el fulfillment (Efraín, 2026-07-17).
const PROYECTOS_ITEMS: NavItemConfig[] = [
  { key: 'doctallas', label: 'Documentación y Tallas', icon: IconDocTallas },
  { key: 'ordenescompra', label: 'Órdenes de Compra', icon: IconOrdenesCompra },
  { key: 'ejecucion', label: 'Reporte de Proyectos', icon: IconEjecucion },
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
    [...VENTAS_ITEMS, ...PROYECTOS_ITEMS, ...CATALOG_ITEMS, ...INVENTARIO_ITEMS, ZONA_EFRAIN_ITEM]
      .map((i) => [i.key, i.label]),
  ),
  home: 'Inicio',
  anuncios: 'Anuncios',
  settings: 'Configuración',
  analisis: 'Análisis',
} as Record<BoardKey, string>;

interface SidebarProps {
  activeBoard: BoardKey;
  onSelectBoard: (key: BoardKey) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** En móvil el sidebar vive dentro de un menú deslizante — sin botón de colapsar. */
  hideCollapse?: boolean;
  /** Campana de notificaciones en el header — omitido dentro del Sidebar interno
   * del menú deslizante móvil (MobileTopBar ya trae su propia campana). */
  onOpenNotification?: (boardKey: string, itemId: string | null) => void;
}

export function Sidebar({ activeBoard, onSelectBoard, collapsed, onToggleCollapsed, hideCollapse, onOpenNotification }: SidebarProps) {
  const me = useMe();
  // Badge de comunicados sin leer. Anuncios no es un board de Monday (como
  // Inicio/Configuración): lo ven TODOS los roles, almacén incluido — un
  // comunicado de dirección es justo lo que ese rol no se puede perder.
  const { noLeidos } = useAnuncios();
  const visible = (items: NavItemConfig[]) => items.filter((item) => me?.boardAccess.includes(item.key));
  const ventasItems = me?.zonaEfrainAccess ? [...visible(VENTAS_ITEMS), ZONA_EFRAIN_ITEM] : visible(VENTAS_ITEMS);
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
        <div style={{ display: 'flex', flexDirection: collapsed ? 'column' : 'row', alignItems: 'center', gap: collapsed ? 6 : 8, padding: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: collapsed ? 'auto' : '100%', height: 32 }}>
            <img src={logo} alt="CMP" style={{ width: 28, height: 28, flex: 'none' }} />
            {!collapsed && (
              <div style={{ font: '800 12px \'Inter\', sans-serif', color: 'var(--ink)', letterSpacing: '.2px', whiteSpace: 'nowrap', overflow: 'hidden', flex: 1 }}>
                CMP Portal
              </div>
            )}
            {onOpenNotification && !collapsed && (
              <NotificationBell onNavigate={onOpenNotification} collapsed={collapsed} />
            )}
          </div>
          {onOpenNotification && collapsed && (
            <NotificationBell onNavigate={onOpenNotification} collapsed={collapsed} />
          )}
        </div>

        {/* "Inicio" no es un board de Monday — no vive en boardAccess/role_board_access
            (mismo trato que Configuración abajo). Visible para todos salvo almacén,
            cuyo trabajo es reactivo y no tiene pendientes que listar (Efraín, 2026-08-10). */}
        {me?.role && me.role !== 'almacen' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 18 }}>
            <NavItem
              icon={<IconHome />}
              label="Inicio"
              active={activeBoard === 'home'}
              collapsed={collapsed}
              onClick={() => onSelectBoard('home')}
            />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: me?.role && me.role !== 'almacen' ? 2 : 18 }}>
          <NavItem
            icon={<IconAnuncios />}
            label="Anuncios"
            active={activeBoard === 'anuncios'}
            collapsed={collapsed}
            onClick={() => onSelectBoard('anuncios')}
            badge={noLeidos}
          />
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
              icon={<IconAnalisis />}
              label="Análisis"
              active={activeBoard === 'analisis'}
              collapsed={collapsed}
              onClick={() => onSelectBoard('analisis')}
            />
          )}
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
