import { lazy, Suspense, useState } from 'react';
import { Sidebar } from './app/Sidebar';
import { MobileTopBar } from './app/MobileTopBar';
import { ImpersonationBanner } from './app/ImpersonationBanner';
import { SessionExpiredScreen } from './app/SessionExpiredScreen';
import { ChatBubble } from './components/assistant/ChatBubble';
import { useRoute } from './lib/routing';
import { useIsMobile } from './lib/useIsMobile';
import { useSessionExpired } from './lib/sessionState';

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

function App() {
  const sessionExpired = useSessionExpired();
  const { board: activeBoard, itemId, navigate } = useRoute();
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();

  if (sessionExpired) return <SessionExpiredScreen />;

  const onOpenChange = (id: string | null) => navigate(activeBoard, id);
  // Duplicar una oportunidad la crea en etapa "Nueva oportunidad" — la nueva
  // vive en el board Oportunidades sin importar desde qué board se duplicó.
  const onDuplicated = (newId: string) => navigate('oportunidades', newId);

  const views = (
    <Suspense fallback={<div style={{ padding: 32 }}>Cargando…</div>}>
      {activeBoard === 'oportunidades' && <OportunidadesBoard openId={itemId} onOpenChange={onOpenChange} onDuplicated={onDuplicated} />}
      {(activeBoard === 'oportunidades_web' || activeBoard === 'costeo' || activeBoard === 'validacion') && (
        // key: cambiar de board debe resetear el estado local (búsqueda),
        // igual que cuando eran 5 componentes distintos.
        <StageBoard key={activeBoard} boardKey={activeBoard} openId={itemId} onOpenChange={onOpenChange} onDuplicated={onDuplicated} />
      )}
      {(activeBoard === 'doctallas' || activeBoard === 'ordenescompra' || activeBoard === 'logistica') && (
        <ProyectoBoard
          key={activeBoard}
          boardKey={activeBoard}
          openId={itemId}
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
    </Suspense>
  );

  // Shell móvil: barra superior con menú deslizante, contenido, y el asistente
  // como barra fija abajo (siempre a un tap) — sin sidebar permanente.
  if (isMobile) {
    return (
      <div className="app-root" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        <ImpersonationBanner />
        <MobileTopBar activeBoard={activeBoard} onSelectBoard={(key) => navigate(key, null)} />
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
