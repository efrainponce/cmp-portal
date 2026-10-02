import { lazy, Suspense, useEffect, useState } from 'react';
import { Sidebar, boardDeEntrada, type BoardKey } from './app/Sidebar';
import { MobileTopBar } from './app/MobileTopBar';
import { ImpersonationBanner } from './app/ImpersonationBanner';
import { SessionExpiredScreen } from './app/SessionExpiredScreen';
import { PhoneGateScreen } from './app/PhoneGateScreen';
import { useRoute, rutaSinBoard } from './lib/routing';
import { useIsMobile } from './lib/useIsMobile';
import { useSessionExpired } from './lib/sessionState';
import { useMe } from './lib/useMe';
import { REFRESCAR_LISTA } from './lib/api';
import { Toaster } from './components/core/Toaster';

// Cada vista es su propio chunk — el bundle inicial solo trae Sidebar + la vista
// activa; las demás se cargan al navegar (misma UI, solo carga diferida).
const OportunidadesBoard = lazy(() => import('./boards/oportunidades/OportunidadesBoard').then((m) => ({ default: m.OportunidadesBoard })));
// Un solo componente para los 5 boards de etapa (Costeo, Validación, Doc/Tallas,
// OC, Logística) — eran 5 wrappers idénticos salvo la config.
const StageBoard = lazy(() => import('./boards/oportunidades/StageBoard').then((m) => ({ default: m.StageBoard })));
// Documentación y Tallas / Órdenes de Compra / Logística viven en el board
// Proyectos directo (no filtrando Oportunidades por etapa) — ver ProyectoBoard.
const ProyectoBoard = lazy(() => import('./boards/proyectos/ProyectoBoard').then((m) => ({ default: m.ProyectoBoard })));
const OcListaBoard = lazy(() => import('./boards/proyectos/OcListaBoard'));
const CotListaBoard = lazy(() => import('./boards/oportunidades/CotListaBoard'));
const MuestrasBoard = lazy(() => import('./boards/muestras/MuestrasBoard'));
const GenericBoardView = lazy(() => import('./boards/generic/GenericBoardView').then((m) => ({ default: m.GenericBoardView })));
const InventarioBoard = lazy(() => import('./boards/inventario/InventarioBoard').then((m) => ({ default: m.InventarioBoard })));
const SettingsPage = lazy(() => import('./app/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AnunciosView = lazy(() => import('./app/AnunciosView').then((m) => ({ default: m.AnunciosView })));
const AnalisisPage = lazy(() => import('./app/AnalisisPage').then((m) => ({ default: m.AnalisisPage })));

function App() {
  const sessionExpired = useSessionExpired();
  const me = useMe();
  const { board: rutaBoard, itemId, tab: openTab, navigate, setTab } = useRoute();
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();

  // Landing por rol: "/" (o una ruta que ya no existe, como "/home") aterriza
  // en el primer board del menú de cada quien — Compras en Costeo, Ventas en
  // Oportunidades, almacén en Inventario. Deep links explícitos (/costeo/123,
  // etc.) nunca pasan por aquí.
  const enRaiz = rutaSinBoard(window.location.pathname);
  useEffect(() => {
    if (!me || !enRaiz) return;
    navigate(boardDeEntrada(me));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);
  // Mientras la URL sea "/" el board de la ruta es el fallback de parsePath
  // (Oportunidades), NO a donde se va a aterrizar. Pintarlo esos instantes
  // montaba la lista y pedía el board completo — ~130 KB y el request más
  // caro del worker — para tirarlo en cuanto /api/me contestaba (medido
  // 2026-09-30). En "/" se pinta directo el aterrizaje, y nada hasta saber el rol.
  // Si /api/me no contesta (API caída), a los 8 s se pinta el board de la ruta
  // como antes, que sí sabe mostrar su estado de error.
  const [sinRol, setSinRol] = useState(false);
  useEffect(() => {
    if (me) return;
    const t = window.setTimeout(() => setSinRol(true), 8000);
    return () => window.clearTimeout(t);
  }, [me]);
  const aterrizaje: BoardKey | null = !enRaiz || (!me && sinRol) ? rutaBoard
    : me ? boardDeEntrada(me) : null;
  const activeBoard = aterrizaje ?? rutaBoard;

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
  const onOpenNotification = (board: string, id: string | null, tab?: string | null) => navigate(board as BoardKey, id, tab ?? null);
  // Clic en el menú sobre el board en el que ya se está, sin drawer abierto:
  // antes no pasaba nada (clic muerto en Clarity) — ahora actualiza la lista.
  const onSelectBoard = (key: BoardKey) => {
    if (key === activeBoard && !itemId) window.dispatchEvent(new Event(REFRESCAR_LISTA));
    else navigate(key, null);
  };

  const views = aterrizaje === null ? <div style={{ padding: 32 }}>Cargando…</div> : (
    <Suspense fallback={<div style={{ padding: 32 }}>Cargando…</div>}>
      {activeBoard === 'oportunidades' && <OportunidadesBoard openId={itemId} openTab={openTab} onTabChange={setTab} onOpenChange={onOpenChange} onDuplicated={onDuplicated} />}
      {(activeBoard === 'oportunidades_web' || activeBoard === 'costeo' || activeBoard === 'validacion' || activeBoard === 'zona_efrain') && (
        // key: cambiar de board debe resetear el estado local (búsqueda),
        // igual que cuando eran 5 componentes distintos.
        <StageBoard key={activeBoard} boardKey={activeBoard} openId={itemId} openTab={openTab} onTabChange={setTab} onOpenChange={onOpenChange} onDuplicated={onDuplicated} />
      )}
      {(activeBoard === 'doctallas' || activeBoard === 'ordenescompra' || activeBoard === 'ejecucion'
        || activeBoard === 'logistica' || activeBoard === 'zona_efrain_proy' || activeBoard === 'estadocuenta') && (
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
      {activeBoard === 'oc_lista' && (
        // El proyecto se abre en "Reporte de Proyectos" (lista TODOS, sin filtro
        // de etapa) directo en su tab de órdenes; sin ese acceso, en el otro
        // board que trae el tab.
        <OcListaBoard onOpenProyecto={(id) => navigate(me?.boardAccess.includes('ejecucion') ? 'ejecucion' : 'ordenescompra', id, 'ordenes')} />
      )}
      {activeBoard === 'cot_lista' && (
        // La oportunidad se abre en el board Oportunidades (abre cualquier id,
        // sin importar la etapa) directo en su tab de cotizaciones.
        <CotListaBoard onOpenOportunidad={(id) => navigate('oportunidades', id, 'cotizacion')} />
      )}
      {activeBoard === 'muestras' && (
        // Directo al tab Muestras del item ligado. El proyecto se abre en el
        // primer board de Proyectos al que la persona tenga acceso.
        <MuestrasBoard openId={itemId} onOpenItem={(s) => navigate(
          s.padre === 'oportunidades' ? 'oportunidades'
            : (['ejecucion', 'ordenescompra', 'doctallas'] as const).find((k) => me?.boardAccess.includes(k)) ?? 'doctallas',
          s.itemId, 'muestras',
        )} />
      )}
      {activeBoard === 'productos' && <GenericBoardView slug="productos" title="Productos" />}
      {activeBoard === 'instituciones' && <GenericBoardView slug="instituciones" title="Instituciones" />}
      {activeBoard === 'contactos' && <GenericBoardView slug="contactos" title="Contactos" />}
      {activeBoard === 'proveedores' && <GenericBoardView slug="proveedores" title="Proveedores" />}
      {activeBoard === 'inventario' && <InventarioBoard />}
      {activeBoard === 'settings' && <SettingsPage />}
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
        <MobileTopBar activeBoard={activeBoard} onSelectBoard={onSelectBoard} onOpenNotification={onOpenNotification} />
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {views}
        </div>
        <Toaster />
      </div>
    );
  }

  return (
    <div className="app-root" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      <ImpersonationBanner />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Sidebar
          activeBoard={activeBoard}
          onSelectBoard={onSelectBoard}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
          onOpenNotification={onOpenNotification}
        />
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {views}
        </div>
      </div>
      <Toaster />
    </div>
  );
}

export default App;
