import { lazy, Suspense, useState } from 'react';
import { Sidebar } from './app/Sidebar';
import { ChatBubble } from './components/assistant/ChatBubble';
import { useRoute } from './lib/routing';

// Cada vista es su propio chunk — el bundle inicial solo trae Sidebar + la vista
// activa; las demás se cargan al navegar (misma UI, solo carga diferida).
const OportunidadesBoard = lazy(() => import('./boards/oportunidades/OportunidadesBoard').then((m) => ({ default: m.OportunidadesBoard })));
const CosteoBoard = lazy(() => import('./boards/costeo/CosteoBoard').then((m) => ({ default: m.CosteoBoard })));
const ValidacionBoard = lazy(() => import('./boards/validacion/ValidacionBoard').then((m) => ({ default: m.ValidacionBoard })));
const DocTallasBoard = lazy(() => import('./boards/doctallas/DocTallasBoard').then((m) => ({ default: m.DocTallasBoard })));
const OrdenesCompraBoard = lazy(() => import('./boards/ordenescompra/OrdenesCompraBoard').then((m) => ({ default: m.OrdenesCompraBoard })));
const LogisticaBoard = lazy(() => import('./boards/logistica/LogisticaBoard').then((m) => ({ default: m.LogisticaBoard })));
const GenericBoardView = lazy(() => import('./boards/generic/GenericBoardView').then((m) => ({ default: m.GenericBoardView })));
const InventarioBoard = lazy(() => import('./boards/inventario/InventarioBoard').then((m) => ({ default: m.InventarioBoard })));
const SettingsPage = lazy(() => import('./app/SettingsPage').then((m) => ({ default: m.SettingsPage })));

function App() {
  const { board: activeBoard, itemId, navigate } = useRoute();
  const [collapsed, setCollapsed] = useState(false);

  const onOpenChange = (id: string | null) => navigate(activeBoard, id);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar
        activeBoard={activeBoard}
        onSelectBoard={(key) => navigate(key, null)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <Suspense fallback={<div style={{ padding: 32 }}>Cargando…</div>}>
          {activeBoard === 'oportunidades' && <OportunidadesBoard openId={itemId} onOpenChange={onOpenChange} />}
          {activeBoard === 'costeo' && <CosteoBoard openId={itemId} onOpenChange={onOpenChange} />}
          {activeBoard === 'validacion' && <ValidacionBoard openId={itemId} onOpenChange={onOpenChange} />}
          {activeBoard === 'doctallas' && <DocTallasBoard openId={itemId} onOpenChange={onOpenChange} />}
          {activeBoard === 'ordenescompra' && <OrdenesCompraBoard openId={itemId} onOpenChange={onOpenChange} />}
          {activeBoard === 'logistica' && <LogisticaBoard openId={itemId} onOpenChange={onOpenChange} />}
          {activeBoard === 'productos' && <GenericBoardView slug="productos" title="Productos" />}
          {activeBoard === 'instituciones' && <GenericBoardView slug="instituciones" title="Instituciones" />}
          {activeBoard === 'contactos' && <GenericBoardView slug="contactos" title="Contactos" />}
          {activeBoard === 'inventario' && <InventarioBoard />}
          {activeBoard === 'settings' && <SettingsPage />}
        </Suspense>
      </div>
      <ChatBubble />
    </div>
  );
}

export default App;
