import { useState } from 'react';
import { Sidebar, type BoardKey } from './app/Sidebar';
import { OportunidadesBoard } from './boards/oportunidades/OportunidadesBoard';
import { CosteoBoard } from './boards/costeo/CosteoBoard';
import { ValidacionBoard } from './boards/validacion/ValidacionBoard';
import { DocTallasBoard } from './boards/doctallas/DocTallasBoard';
import { OrdenesCompraBoard } from './boards/ordenescompra/OrdenesCompraBoard';
import { LogisticaBoard } from './boards/logistica/LogisticaBoard';
import { GenericBoardView } from './boards/generic/GenericBoardView';
import { SettingsPage } from './app/SettingsPage';

function App() {
  const [activeBoard, setActiveBoard] = useState<BoardKey>('oportunidades');
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', overflow: 'hidden', background: 'var(--bg)' }}>
      <Sidebar
        activeBoard={activeBoard}
        onSelectBoard={setActiveBoard}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {activeBoard === 'oportunidades' && <OportunidadesBoard />}
        {activeBoard === 'costeo' && <CosteoBoard />}
        {activeBoard === 'validacion' && <ValidacionBoard />}
        {activeBoard === 'doctallas' && <DocTallasBoard />}
        {activeBoard === 'ordenescompra' && <OrdenesCompraBoard />}
        {activeBoard === 'logistica' && <LogisticaBoard />}
        {activeBoard === 'productos' && <GenericBoardView slug="productos" title="Productos" />}
        {activeBoard === 'instituciones' && <GenericBoardView slug="instituciones" title="Instituciones" />}
        {activeBoard === 'contactos' && <GenericBoardView slug="contactos" title="Contactos" />}
        {activeBoard === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}

export default App;
