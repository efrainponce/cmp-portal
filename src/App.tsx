import { lazy, Suspense, useState } from 'react';
import { Sidebar } from './app/Sidebar';
import { ImpersonationBanner } from './app/ImpersonationBanner';
import { ChatBubble } from './components/assistant/ChatBubble';
import { useRoute } from './lib/routing';

// Cada vista es su propio chunk — el bundle inicial solo trae Sidebar + la vista
// activa; las demás se cargan al navegar (misma UI, solo carga diferida).
const OportunidadesBoard = lazy(() => import('./boards/oportunidades/OportunidadesBoard').then((m) => ({ default: m.OportunidadesBoard })));
// Un solo componente para los 5 boards de etapa (Costeo, Validación, Doc/Tallas,
// OC, Logística) — eran 5 wrappers idénticos salvo la config.
const StageBoard = lazy(() => import('./boards/oportunidades/StageBoard').then((m) => ({ default: m.StageBoard })));
const GenericBoardView = lazy(() => import('./boards/generic/GenericBoardView').then((m) => ({ default: m.GenericBoardView })));
const InventarioBoard = lazy(() => import('./boards/inventario/InventarioBoard').then((m) => ({ default: m.InventarioBoard })));
const SettingsPage = lazy(() => import('./app/SettingsPage').then((m) => ({ default: m.SettingsPage })));

function App() {
  const { board: activeBoard, itemId, navigate } = useRoute();
  const [collapsed, setCollapsed] = useState(false);

  const onOpenChange = (id: string | null) => navigate(activeBoard, id);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <ImpersonationBanner />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Sidebar
          activeBoard={activeBoard}
          onSelectBoard={(key) => navigate(key, null)}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <Suspense fallback={<div style={{ padding: 32 }}>Cargando…</div>}>
            {activeBoard === 'oportunidades' && <OportunidadesBoard openId={itemId} onOpenChange={onOpenChange} />}
            {(activeBoard === 'costeo' || activeBoard === 'validacion' || activeBoard === 'doctallas'
              || activeBoard === 'ordenescompra' || activeBoard === 'logistica') && (
              // key: cambiar de board debe resetear el estado local (búsqueda),
              // igual que cuando eran 5 componentes distintos.
              <StageBoard key={activeBoard} boardKey={activeBoard} openId={itemId} onOpenChange={onOpenChange} />
            )}
            {activeBoard === 'productos' && <GenericBoardView slug="productos" title="Productos" />}
            {activeBoard === 'instituciones' && <GenericBoardView slug="instituciones" title="Instituciones" />}
            {activeBoard === 'contactos' && <GenericBoardView slug="contactos" title="Contactos" />}
            {activeBoard === 'inventario' && <InventarioBoard />}
            {activeBoard === 'settings' && <SettingsPage />}
          </Suspense>
        </div>
        <ChatBubble />
      </div>
    </div>
  );
}

export default App;
