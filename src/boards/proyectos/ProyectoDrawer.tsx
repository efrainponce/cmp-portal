// Drawer del Proyecto (post-venta), abierto siempre por su propio id — nunca
// depende del board_relation hacia la Oportunidad (ver worker/lib/dal.ts).
// Reusa ProyectoTallasSection/ProyectoOrdenesSection/OcContratoSection tal
// cual (mismo contrato ProyectoState, solo que aquí se construye directo del
// item ya cargado, sin pasar por la Oportunidad). Cotización y Embellecimientos
// viven también aquí desde 2026-08-10/2026-08-12 (Efraín) — leen las líneas
// vigentes de la Oportunidad ligada (CotizacionVirtualTab/EmbellecimientosVirtualTab,
// worker/lib/proyectoCotizacionVirtual.ts); "Editar/Dividir" en Cotización SÍ
// escribe a Monday desde 2026-08-13. Capturar zonas/imágenes de embellecimiento
// sigue siendo exclusivo de la Oportunidad (link cruzado abajo).
import { useEffect, useRef, useState } from 'react';
import { useLiveRefresh } from '../../lib/useLiveRefresh';
import { readIsCurrent, readRevision } from '../../lib/readConsistency';
import { Button } from '../../components/core/Button';
import { IconBack } from '../../components/icons';
import { SyncIndicator } from '../../components/board/SyncIndicator';
import { EditableItemName } from '../../components/board/EditableItemName';
import { getItemDetail, refreshItem, getProyectoOportunidad, useBoards, colForBoard, type ItemDetailDTO } from '../../lib/api';
import { useIsMobile } from '../../lib/useIsMobile';
import { useMe } from '../../lib/useMe';
import { ActualizacionesTab } from '../oportunidades/tabs/ActualizacionesTab';
import { ActividadTab } from '../oportunidades/tabs/ActividadTab';
import { FechaEntregaField, OcContratoSection, ActaEntregaSection } from '../oportunidades/tabs/DocumentacionTab';
import { ProyectoTallasSection, ProyectoOrdenesSection, EjecucionSection, LogisticaSection, type ProyectoState } from '../oportunidades/ProyectoSection';
import { CotizacionVirtualTab } from './CotizacionVirtualTab';
import { CosteoProyectoTab } from './CosteoProyectoTab';
import { EmbellecimientosVirtualTab } from './EmbellecimientosVirtualTab';
import { EstadoCuentaTab } from './EstadoCuentaTab';
import type { ProjectBoardKey } from '../../lib/projectStages';
import type { OportunidadLigadaDTO } from '../../../shared/dto';
import { canReadActivity } from '../../../shared/visibility';

type ProyectoTabKey = 'estadocuenta' | 'actualizaciones' | 'actividad' | 'cotizacion' | 'costeo' | 'embellecimientos' | 'documentacion' | 'tallas' | 'ordenes' | 'ejecucion' | 'logistica';

const FOLIO_COL = 'pulse_id_mm1a12gy';
const INSTITUCION_COL = 'lookup_mm1dwn6';
const FECHA_ENTREGA_COL = 'date_mm0m1vfv';
const VENDEDOR_COL = 'multiple_person_mm0hrnqq';

const TABS: { key: ProyectoTabKey; label: string }[] = [
  // Cobros y pagos del proyecto (Efraín, 2026-09-08). Va primero porque SOLO
  // se lista en el board "Estado de Cuenta" (TABS_BY_BOARD) y ahí es la
  // pestaña principal; en los demás accesos ni aparece. Por-usuario: la
  // whitelist de shared/visibility.ts puedeVerEstadoCuenta.
  { key: 'estadocuenta', label: 'Estado de cuenta' },
  { key: 'actualizaciones', label: 'Actualizaciones' },
  // Log de cambios del Proyecto y de sus líneas — el costeo de la OC se edita
  // desde el portal y Monday lo atribuiría todo al usuario del token, así que
  // el actor real solo se ve aquí (Efraín, 2026-08-18: "guardar la actividad
  // por si cometemos error"). El reloj de cada línea en Órdenes de compra es
  // la vista corta de lo mismo.
  { key: 'actividad', label: 'Actividad' },
  { key: 'cotizacion', label: 'Cotización' },
  // Costeo completo de la Oportunidad ligada, solo lectura (Efraín,
  // 2026-08-27). Va SOLO en el Reporte de Proyectos y solo para admin — ver el
  // filtro de la barra de tabs más abajo; el tab "Cotización" de arriba es la
  // vista corta y sí escribe, este no escribe nada.
  { key: 'costeo', label: 'Costeo' },
  { key: 'embellecimientos', label: 'Embellecimientos' },
  { key: 'documentacion', label: 'Documentación' },
  { key: 'tallas', label: 'Tallas' },
  { key: 'ordenes', label: 'Órdenes de compra' },
  { key: 'ejecucion', label: 'Ejecución' },
  { key: 'logistica', label: 'Logística' },
];

// Cada acceso del sidebar solo necesita ver sus propios tabs, no los 8
// (Efraín, 2026-08-05): "Documentación y Tallas" -> doc+tallas; "Órdenes de
// Compra" -> doc+tallas+ordenes. Ejecución/Logística se quedan con el set
// completo hasta que se pida lo mismo para esos accesos. Actualizaciones va
// en TODOS los accesos (Efraín, 2026-08-10: "no todos los boards tienen
// actualizaciones" — se había quedado fuera de estos dos por error, no a propósito).
// Cotización/Embellecimientos van en los 4 accesos por igual (Efraín, 2026-08-12).
// El tercer segmento de la URL (/<board>/<id>/<tab>) se valida contra TABS
// antes de abrir el drawer ahí; cualquier otra cosa cae al defaultTab del board.
function esTab(v: string | null | undefined): v is ProyectoTabKey {
  return !!v && TABS.some((t) => t.key === v);
}

const TABS_BY_BOARD: Partial<Record<ProjectBoardKey, ProyectoTabKey[]>> = {
  doctallas: ['actualizaciones', 'actividad', 'cotizacion', 'embellecimientos', 'documentacion', 'tallas'],
  ordenescompra: ['actualizaciones', 'actividad', 'cotizacion', 'embellecimientos', 'documentacion', 'tallas', 'ordenes'],
  // Estado de Cuenta: lo suyo más la cotización (qué se vendió) y las
  // actualizaciones. Sin OC/tallas/logística: aquí se cobra, no se produce.
  estadocuenta: ['estadocuenta', 'cotizacion', 'actualizaciones'],
};

interface Props {
  id: string;
  boardKey: ProjectBoardKey;
  backLabel: string;
  defaultTab: string;
  /** Pestaña pedida por la URL y su reflejo de vuelta (link copiable). */
  openTab?: string | null;
  onTabChange?: (tab: string) => void;
  onBack: () => void;
  /** Abre la Oportunidad ligada en su propio drawer (cotización/embellecimientos viven ahí). */
  onOpenOportunidad: (id: string) => void;
}

// SWR de sesión — mismo patrón que OpportunityDrawer.
const detailCache = new Map<string, ItemDetailDTO>();
// Oportunidad ligada por proyecto: la liga no cambia, y sin recordarla el link
// "Ver Oportunidad…" aparecía tarde y empujaba las pestañas en cada apertura.
const oportunidadCache = new Map<string, OportunidadLigadaDTO | null>();

function Cargando() {
  return <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>;
}

/** Proyecto sin Oportunidad ligada — el caso normal de un proyecto creado desde
 * cero para levantar una OC (src/boards/proyectos/CrearProyectoModal.tsx). No es
 * un error: estos dos tabs leen las líneas de la Oportunidad y aquí no hay. */
function SinOportunidad({ que }: { que: string }) {
  return (
    <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--ink-quiet)', maxWidth: 560 }}>
      Este proyecto no tiene una Oportunidad ligada. {que} sale de la cotización de la Oportunidad,
      así que aquí no hay nada que mostrar — los productos de la orden de compra se capturan en el
      tab «Órdenes de compra», con «+ Agregar producto».
    </div>
  );
}

export function ProyectoDrawer({ id, boardKey, backLabel, defaultTab, openTab, onTabChange, onBack, onOpenOportunidad }: Props) {
  const isMobile = useIsMobile();
  const me = useMe();
  const [item, setItem] = useState<ItemDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<ProyectoTabKey>(() => (esTab(openTab) ? openTab : defaultTab as ProyectoTabKey));
  const cambiarTab = (t: ProyectoTabKey) => { setTab(t); onTabChange?.(t); };
  // Tab "Costeo": solo admin y solo en el Reporte de Proyectos (Efraín,
  // 2026-08-27, "SOLO PARA ADMINS"). Gatea el tab Y su contenido — el tercer
  // segmento de la URL (/ejecucion/<id>/costeo) es copiable y llegaría igual a
  // quien no le toca. El server filtra las columnas de costo por rol de todos
  // modos (shared/visibility.ts), esto es lo que se PINTA.
  const puedeVerCosteo = boardKey === 'ejecucion' && me?.role === 'admin';
  // Estado de cuenta: solo en su board y solo para la whitelist por correo
  // (me.estadoCuentaAccess). Gatea tab Y contenido — la URL
  // /estadocuenta/<id>/estadocuenta es copiable; el worker responde 403 al
  // resto de todos modos, esto es lo que se PINTA.
  const puedeVerEstadoCuenta = boardKey === 'estadocuenta' && !!me?.estadoCuentaAccess;
  // La Oportunidad ligada con su folio: el link del encabezado lo pinta ("Ver
  // Oportunidad OPP-0085", Efraín 2026-09-10); los tabs solo usan el id.
  const [oportunidad, setOportunidad] = useState<OportunidadLigadaDTO | null>(null);
  const oportunidadId = oportunidad?.id ?? null;
  // Tri-estado a mano: `oportunidadId === null` significa las DOS cosas
  // (todavía no llega la respuesta / no hay oportunidad ligada) y Cotización y
  // Embellecimientos necesitan distinguirlas — un proyecto hecho desde cero
  // (shared/createFields.ts) no tiene oportunidad y sus endpoints responden 404
  // a propósito ("Este proyecto no tiene una Oportunidad ligada"), que pintado
  // en rojo se lee como una falla del portal.
  const [oppResuelta, setOppResuelta] = useState(false);
  // Nombre del proyecto: mismo permiso que el de la oportunidad (Efraín, 2026-08-13).
  const { boards } = useBoards();
  const canEditNombre = !!colForBoard(boards, 'proyectos').find((c) => c.id === 'name')?.w;

  // Mismo patrón que OpportunityDrawer: loadSeq descarta respuestas viejas que
  // llegan tarde, y una lectura DE FONDO que se cruzó con un write se tira
  // (src/lib/readConsistency.ts) para no "regresar" el cambio en pantalla.
  const loadSeqRef = useRef(0);
  const cargar = (fondo: boolean) => {
    if (!fondo) setError(null);
    const seq = ++loadSeqRef.current;
    const rev = readRevision();
    return getItemDetail('proyectos', id)
      .then(({ item: it }) => {
        if (loadSeqRef.current !== seq || (fondo && !readIsCurrent(rev))) return;
        detailCache.set(id, it);
        setItem(it);
      })
      .catch(() => {
        if (loadSeqRef.current !== seq || fondo) return;
        setError('No se pudo cargar el proyecto. Verifica tu acceso o que el servidor esté disponible.');
      });
  };
  const load = () => { void cargar(false); };
  // Refresco en vivo cada 5 s (ver liveRefresh.ts): tallas, OC y ejecución
  // que escribe cmp-tallas o el equipo en Monday aparecen sin reabrir.
  useLiveRefresh(id, () => cargar(true), refreshing);

  useEffect(() => {
    setItem(detailCache.get(id) ?? null);
    setTab(esTab(openTab) ? openTab : defaultTab as ProyectoTabKey);
    const oppPrevia = oportunidadCache.get(id);
    setOportunidad(oppPrevia ?? null);
    setOppResuelta(oppPrevia !== undefined);
    load();
    getProyectoOportunidad(id)
      .then((o) => { oportunidadCache.set(id, o); setOportunidad(o); })
      .catch(() => setOportunidad(null))
      .finally(() => setOppResuelta(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refreshItem('proyectos', id); } catch { /* offline demo: ignore */ }
    load();
    setRefreshing(false);
  };

  if (error) {
    return <div style={{ padding: 32, font: 'var(--text-label)', color: 'var(--status-perdida)' }}>{error}</div>;
  }
  if (!item) {
    return <div style={{ padding: 32, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>;
  }

  const proyectoState: ProyectoState = { loading: false, proyecto: item, reload: load };
  const institucion = item.cols[INSTITUCION_COL]?.text;
  const folio = item.cols[FOLIO_COL]?.text || '—';
  const fechaEntrega = item.cols[FECHA_ENTREGA_COL]?.text;
  const vendedor = item.cols[VENDEDOR_COL]?.text;
  const subtitle = [institucion, fechaEntrega ? `Entrega: ${fechaEntrega}` : null, vendedor ? `Vendedor: ${vendedor}` : null]
    .filter(Boolean).join(' · ');

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: isMobile ? '14px 14px 10px' : '20px 32px 12px', borderBottom: '1px solid var(--border)' }}>
        <div
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', font: 'var(--text-label)', color: 'var(--ink-tertiary)', marginBottom: 10, width: 'fit-content' }}
        >
          <IconBack style={{ width: 14, height: 14 }} /> {backLabel}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <EditableItemName
              slug="proyectos"
              itemId={id}
              name={item.name}
              canEdit={canEditNombre && item.ownedByViewer !== false}
              font="var(--text-title)"
              onRenamed={(nombre) => setItem((cur) => {
                if (!cur) return cur;
                const next = { ...cur, name: nombre };
                detailCache.set(id, next);
                return next;
              })}
            />
            <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
              Folio: {folio}{subtitle ? ` · ${subtitle}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SyncIndicator syncedAt={item.syncedAt} pending={item.pendingWrite ? 1 : 0} label="actualizado" />
            <Button variant="secondary" onClick={refreshing ? undefined : onRefresh}>
              {refreshing ? 'Actualizando…' : 'Actualizar'}
            </Button>
          </div>
        </div>
        {/* Mientras no se sabe si hay oportunidad ligada se aparta el renglón
            (casi todos los proyectos la tienen): el link llegaba ~0.7 s después
            y brincaba pestañas y contenido 21 px (medido, perf-cls.mjs). */}
        {(oportunidad || !oppResuelta) && (
          <div
            onClick={oportunidad ? () => onOpenOportunidad(oportunidad.id) : undefined}
            style={{
              marginTop: 8, font: 'var(--text-label-strong)', color: 'var(--accent)', cursor: 'pointer', width: 'fit-content',
              visibility: oportunidad ? 'visible' : 'hidden',
            }}
          >
            Ver Oportunidad {oportunidad?.folio || 'ligada'} (cotización, embellecimientos) ↗
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '0 14px' : '0 32px', borderBottom: '1px solid var(--border)', flex: 'none', overflowX: 'auto' }}>
        {(TABS_BY_BOARD[boardKey] ? TABS.filter((t) => TABS_BY_BOARD[boardKey]!.includes(t.key)) : TABS)
          // Precio de Venta: solo vendedor/compras/admin lo ven (shared/visibility.ts,
          // grupo V) — almacén no debe ver Cotización ni Embellecimientos (esta
          // última ahora también muestra precio unitario/subtotal por línea).
          .filter((t) => (t.key !== 'cotizacion' && t.key !== 'embellecimientos') || me?.role !== 'almacen')
          // Historial de cambios: solo Compras/Admin (shared/visibility.ts
          // canReadActivity, Efraín 2026-08-18) — el endpoint responde 403 al resto.
          .filter((t) => t.key !== 'actividad' || (me != null && canReadActivity(me.role)))
          // Costeo completo: solo admin y solo en el Reporte de Proyectos
          // (Efraín, 2026-08-27, "SOLO PARA ADMINS"). El server filtra las
          // columnas de costo por rol de todos modos (shared/visibility.ts),
          // pero el tab no tiene por qué asomarse en los demás accesos.
          .filter((t) => t.key !== 'costeo' || puedeVerCosteo)
          .filter((t) => t.key !== 'estadocuenta' || puedeVerEstadoCuenta)
          .map((t) => (
          <div
            key={t.key}
            onClick={() => cambiarTab(t.key)}
            style={{
              padding: '9px 4px', marginRight: 14, font: '500 11.5px var(--font-ui)', cursor: 'pointer', whiteSpace: 'nowrap',
              color: tab === t.key ? 'var(--ink)' : 'var(--ink-quiet)',
              borderBottom: '2px solid ' + (tab === t.key ? 'var(--accent)' : 'transparent'),
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'estadocuenta' && (
        me == null ? <Cargando />
          : !puedeVerEstadoCuenta ? (
            <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
              {me.estadoCuentaAccess
                ? 'El estado de cuenta se consulta desde el acceso «Estado de Cuenta» del menú.'
                : 'El estado de cuenta solo lo ve dirección.'}
            </div>
          )
            : <EstadoCuentaTab proyectoId={id} editable={item.ownedByViewer !== false} />
      )}
      {tab === 'actualizaciones' && <ActualizacionesTab slug="proyectos" itemId={id} />}
      {tab === 'actividad' && <ActividadTab slug="proyectos" itemId={id} />}
      {tab === 'cotizacion' && (
        !oppResuelta ? <Cargando />
          : oportunidadId ? <CotizacionVirtualTab proyectoId={id} />
            : <SinOportunidad que="La cotización" />
      )}
      {tab === 'costeo' && (
        me == null ? <Cargando />
          : !puedeVerCosteo ? (
            <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
              El costeo completo solo lo ve dirección.
            </div>
          )
            : !oppResuelta ? <Cargando />
              : oportunidadId ? <CosteoProyectoTab oportunidadId={oportunidadId} />
                : <SinOportunidad que="El costeo" />
      )}
      {tab === 'embellecimientos' && (
        !oppResuelta ? <Cargando />
          : oportunidadId ? <EmbellecimientosVirtualTab proyectoId={id} proyecto={item} onChanged={load} />
            : <SinOportunidad que="Los embellecimientos" />
      )}
      {tab === 'documentacion' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <FechaEntregaField proyecto={proyectoState} />
          <OcContratoSection proyecto={proyectoState} oppId={oportunidadId} />
          <ActaEntregaSection proyecto={proyectoState} oppId={oportunidadId} />
        </div>
      )}
      {tab === 'tallas' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <ProyectoTallasSection state={proyectoState} oppId={oportunidadId} />
        </div>
      )}
      {tab === 'ordenes' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <ProyectoOrdenesSection state={proyectoState} oppId={oportunidadId} />
        </div>
      )}
      {tab === 'ejecucion' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <EjecucionSection state={proyectoState} oppId={oportunidadId} />
        </div>
      )}
      {/* La captura de recolección (encargado, guías, evidencia) se construyó el
          2026-08-17 para el drawer de la Oportunidad y este quedó con el
          "próximamente" de antes — o sea que el board del sidebar que se LLAMA
          Logística mostraba un placeholder. Es el mismo componente y los mismos
          permisos (Compras/Admin editan; el server revalida), así que aquí solo
          se conecta (Efraín, 2026-08-17). */}
      {tab === 'logistica' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <LogisticaSection state={proyectoState} oppId={oportunidadId} />
        </div>
      )}
    </div>
  );
}
