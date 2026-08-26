import { lazy, Suspense, useEffect, useState } from 'react';
import { Sidebar, type BoardKey } from './app/Sidebar';
import { MobileTopBar } from './app/MobileTopBar';
import { ImpersonationBanner } from './app/ImpersonationBanner';
import { SessionExpiredScreen } from './app/SessionExpiredScreen';
import { PhoneGateScreen } from './app/PhoneGateScreen';
import { ChatBubble } from './components/assistant/ChatBubble';
import { useRoute } from './lib/routing';
import { useIsMobile } from './lib/useIsMobile';
import { useSessionExpired } from './lib/sessionState';
import { useMe } from './lib/useMe';

// Cada vista es su propio chunk — el bundle inicial solo trae Sidebar + la vista
// activa; las demás se cargan al navegar (misma UI, solo carga diferida).
const OportunidadesBoard = lazy(() => import('./boards/oportunidades/OportunidadesBoard').then((m) => ({ default: m.OportunidadesBoard })));
// Un solo componente para los 5 boards de etapa (Costeo, Validación, Doc/Tallas,
// OC, Logística) — eran 5 wrappers idénticos salvo la config.
const StageBoard = lazy(() => import('./boards/oportunidades/StageBoard').then((m) => ({ default: m.StageBoard })));
// Documentación y Tallas / Órdenes de Compra / Logística viven en el board
// Proyectos directo (no filtrando Oportunidades por etapa) — ver ProyectoBoard.
const ProyectoBoard = lazy(() => import('./boards/proyectos/ProyectoBoard').then((m) => ({ default: m.ProyectoBoard })));
const GenericBoardView = lazy(() => import('./boards/generic/GenericBoardView').then((m) => ({ default: m.GenericBoardView })));
const InventarioBoard = lazy(() => import('./boards/inventario/InventarioBoard').then((m) => ({ default: m.InventarioBoard })));
const SettingsPage = lazy(() => import('./app/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const HomeView = lazy(() => import('./app/HomeView').then((m) => ({ default: m.HomeView })));
const AnunciosView = lazy(() => import('./app/AnunciosView').then((m) => ({ default: m.AnunciosView })));
const AnalisisPage = lazy(() => import('./app/AnalisisPage').then((m) => ({ default: m.AnalisisPage })));

function App() {
  const sessionExpired = useSessionExpired();
  const me = useMe();
  const { board: activeBoard, itemId, tab: openTab, navigate, setTab } = useRoute();
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();

  // Landing por rol: la ruta raíz sin filo del fallback de parsePath ("/")
  // aterriza en Inicio para vendedor/compras/admin — almacén sigue yendo a
  // Inventario (su trabajo es reactivo, sin pendientes que listar). Deep
  // links explícitos (/costeo/123, etc.) nunca pasan por aquí.
  useEffect(() => {
    if (!me || window.location.pathname !== '/') return;
    navigate(me.role === 'almacen' ? 'inventario' : 'home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  if (sessionExpired) return <SessionExpiredScreen />;
  // impersonatedBy presente = un admin viendo "como" otra cuenta — ahí solo
  // está mirando, no tiene por qué llenar el teléfono de alguien más. Los
  // admins tampoco se bloquean: si su teléfono choca con otra cuenta (phone es
  // UNIQUE), Configuración es la ÚNICA pantalla que puede resolverlo — un admin
  // encerrado por el gate no tiene forma de llegar ahí a arreglarlo (incidente
  // real, 2026-07-31). Vendedor/compras/almacén sí lo siguen exigiendo.
  if (me && !me.phone && !me.impersonatedBy && me.role !== 'admin') return <PhoneGateScreen />;

  const onOpenChange = (id: string | null) => navigate(activeBoard, id);
  // Duplicar una oportunidad la crea en etapa "Nueva oportunidad" — la nueva
  // vive en el board Oportunidades sin importar desde qué board se duplicó.
  const onDuplicated = (newId: string) => navigate('oportunidades', newId);
  // Deep link de una notificación: navega al board+item indicados (abre el
  // drawer si es una oportunidad, igual que cualquier otro link directo).
  const onOpenNotification = (board: string, id: string | null) => navigate(board as BoardKey, id);

  const views = (
    <Suspense fallback={<div style={{ padding: 32 }}>Cargando…</div>}>
      {activeBoard === 'oportunidades' && <OportunidadesBoard openId={itemId} openTab={openTab} onTabChange={setTab} onOpenChange={onOpenChange} onDuplicated={onDuplicated} />}
      {(activeBoard === 'oportunidades_web' || activeBoard === 'costeo' || activeBoard === 'validacion' || activeBoard === 'zona_efrain') && (
        // key: cambiar de board debe resetear el estado local (búsqueda),
        // igual que cuando eran 5 componentes distintos.
        <StageBoard key={activeBoard} boardKey={activeBoard} openId={itemId} openTab={openTab} onTabChange={setTab} onOpenChange={onOpenChange} onDuplicated={onDuplicated} />
      )}
      {(activeBoard === 'doctallas' || activeBoard === 'ordenescompra' || activeBoard === 'ejecucion'
        || activeBoard === 'logistica' || activeBoard === 'zona_efrain_proy') && (
        <ProyectoBoard
          key={activeBoard}
          boardKey={activeBoard}
          openId={itemId}
          openTab={openTab}
          onTabChange={setTab}
          onOpenChange={onOpenChange}
          onOpenOportunidad={(oppId) => navigate('oportunidades', oppId)}
        />
      )}
      {activeBoard === 'productos' && <GenericBoardView slug="productos" title="Productos" />}
      {activeBoard === 'instituciones' && <GenericBoardView slug="instituciones" title="Instituciones" />}
      {activeBoard === 'contactos' && <GenericBoardView slug="contactos" title="Contactos" />}
      {activeBoard === 'proveedores' && <GenericBoardView slug="proveedores" title="Proveedores" />}
      {activeBoard === 'inventario' && <InventarioBoard />}
      {activeBoard === 'settings' && <SettingsPage />}
      {activeBoard === 'home' && <HomeView onOpenPendiente={onOpenNotification} />}
      {activeBoard === 'anuncios' && <AnunciosView />}
      {activeBoard === 'analisis' && <AnalisisPage onOpenOportunidad={(id) => navigate('oportunidades', id)} />}
    </Suspense>
  );

  // Shell móvil: barra superior con menú deslizante, contenido, y el asistente
  // como barra fija abajo (siempre a un tap) — sin sidebar permanente.
  if (isMobile) {
    return (
      <div className="app-root" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        <ImpersonationBanner />
        <MobileTopBar activeBoard={activeBoard} onSelectBoard={(key) => navigate(key, null)} onOpenNotification={onOpenNotification} />
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {views}
        </div>
        <ChatBubble variant="dock" />
      </div>
    );
  }

  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <ImpersonationBanner />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Sidebar
          activeBoard={activeBoard}
          onSelectBoard={(key) => navigate(key, null)}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          onOpenNotification={onOpenNotification}
        />
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {views}
        </div>
        <ChatBubble />
      </div>
    </div>
  );
}

export default App;
