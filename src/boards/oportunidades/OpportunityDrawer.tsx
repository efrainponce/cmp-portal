// Shared full-tab detail drawer opened from every stage-filtered Oportunidades
// list (Oportunidades, Costeo, Validación Costeo, Documentación y Tallas,
// Órdenes de Compra, Logística) — same record, same tab set, per the design's
// "Board Tabs" component. Acciones por etapa = los mismos flujos de cmp-tallas
// que los botones de Monday (docs/cmp-tallas-endpoint-map.md): los botones se
// deshabilitan hasta que todo está listo y los rechazos se muestran legibles.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/core/Button';
import { ConfirmButton } from '../../components/core/ConfirmButton';
import { IconBack, IconEdit, IconLink } from '../../components/icons';
import { SyncIndicator } from '../../components/board/SyncIndicator';
import { StatusBadge } from '../../components/core/Badges';
import { chipFor } from '../../components/board/cellHelpers';
import { useMe } from '../../lib/useMe';
import {
  useBoards, colForBoard, checkCosteo, checkValidacion, validarCosteo, duplicarOportunidad, duplicarVersion, enviarCosteo, enviarValidacion, ganarOportunidad, generarCotizacion, getItemDetail, getVersiones,
  refreshItem, restaurarVersion, patchItem, type ItemDetailDTO, type QuoteVersionDTO,
} from '../../lib/api';
import { statusIndex } from '../../lib/statusValue';
import { DEAL_STAGE_LABELS, stageAtOrAfter, type StageBoardKey } from '../../lib/dealStages';
import { useIsMobile } from '../../lib/useIsMobile';
import { uxAction, uxNav } from '../../lib/telemetry';
import { BoardTabsBar, type DrawerTabKey } from './BoardTabsBar';
import { CotizacionTab } from './tabs/CotizacionTab';
import { ETAPA_COSTEO_COL } from './tabs/cotizacion/gridMeta';
import { Modal } from '../../components/core/Modal';
import { EmbellecimientosTab } from './tabs/EmbellecimientosTab';
import { ActualizacionesTab } from './tabs/ActualizacionesTab';
import { ActividadTab } from './tabs/ActividadTab';
import { NuevosProductosTab } from './tabs/NuevosProductosTab';
import { DocumentacionTab } from './tabs/DocumentacionTab';
import { TallasTab } from './tabs/TallasTab';
import { useProyecto, ProyectoOrdenesSection, EjecucionSection, LogisticaSection } from './ProyectoSection';
import { PaymentRequestButton } from '../../components/board/PaymentRequestButton';
import { EditableItemName } from '../../components/board/EditableItemName';
import { EditClienteModal } from './EditClienteModal';
import { EditInstitucionModal } from './EditInstitucionModal';
import { EditPersonaModal } from './EditPersonaModal';
import { DuplicarOportunidadModal } from './DuplicarOportunidadModal';

interface Props {
  id: string;
  backLabel: string;
  defaultTab: string;
  onBack: () => void;
  /** Origin board — drives the Cotizaciones variant (costeo boards see cost breakdown). */
  boardKey?: StageBoardKey;
  /** Llamado con el id de la oportunidad nueva tras "Duplicar". */
  onDuplicated: (newId: string) => void;
}

// Boards que ven el desglose de costos en la grid de Cotización. 'zona_efrain'
// va aquí porque ahí una sola persona hace el recorrido completo (cotizar,
// costear, aprobar el precio) sin cambiar de board — ver `zonaPrivada`.
const COSTEO_VARIANT_BOARDS: StageBoardKey[] = ['costeo', 'validacion', 'zona_efrain'];
const PRECIO_COL = 'numeric_mkzneg3d';   // Precio de Venta C/U (subitems)
const INSTITUCION_COL = 'lookup_mm1bs976'; // mirror desde Contacto (se edita en el contacto, ver EditInstitucionModal)
const CONTACTO_COL = 'deal_contact';       // board_relation → Contactos ("Cliente")
const VENDEDOR_COL = 'deal_owner';         // people
const COMPRAS_COL = 'multiple_person_mm03qyw9'; // people ("Comprador")

// SWR de sesión: al reabrir una oportunidad ya visitada, el drawer pinta al
// instante desde este cache y el fetch fresco lo corrige en background. Vive a
// nivel módulo (sobrevive mount/unmount del drawer, muere con el reload).
//
// Con tope: un detalle pesa ~138 KB y sus versiones ~31 KB, así que sin límite
// una jornada recorriendo oportunidades dejaba varios MB retenidos en máquinas
// que ya andan justas de RAM. 6 entradas cubren el ir y venir entre unas pocas
// oportunidades, que es para lo que existe el cache.
const CACHE_MAX = 6;
const detailCache = new Map<string, ItemDetailDTO>();
const versionsCache = new Map<string, QuoteVersionDTO[]>();

/** set con tope LRU — Map preserva orden de inserción, así que re-insertar
 * manda la entrada al final y la primera llave es la más vieja. */
function cacheSet<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

interface Notice { kind: 'ok' | 'error'; title: string; lines: string[] }

/** Lápiz discreto junto a un campo del header — reemplaza el link "Cambiar" para
 * que la fila Institución/Cliente/Vendedor/Comprador no se sienta saturada de texto. */
function ChangeIconButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', background: 'none', padding: 2, marginLeft: -4,
        color: 'var(--ink-quiet)', cursor: 'pointer', borderRadius: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-quiet)'; }}
    >
      <IconEdit style={{ width: 13, height: 13 }} />
    </button>
  );
}

export function OpportunityDrawer({ id, backLabel, defaultTab, onBack, boardKey, onDuplicated }: Props) {
  const isMobile = useIsMobile();
  const me = useMe();
  const canDuplicate = !!me;
  const [duplicating, setDuplicating] = useState(false);
  const [showDuplicar, setShowDuplicar] = useState(false);
  const { boards } = useBoards();
  const subCols = colForBoard(boards, 'oportunidades_sub');
  const oppCols = colForBoard(boards, 'oportunidades');
  const canEditCliente = !!oppCols.find((c) => c.id === CONTACTO_COL)?.w;
  // Institución: no vive en la oportunidad (es espejo del Contacto), así que el
  // permiso es el de `contact_account` en Contactos — el mismo que ya usa
  // EditContactoModal (vendedor + admin).
  const canEditInstitucion = !!colForBoard(boards, 'contactos').find((c) => c.id === 'contact_account')?.w;
  const canEditVendedor = !!oppCols.find((c) => c.id === VENDEDOR_COL)?.w;
  const canEditComprador = !!oppCols.find((c) => c.id === COMPRAS_COL)?.w;
  // Nombre de la oportunidad: editable en los 6 boards de etapa, incluidos los
  // de Compras (Efraín, 2026-08-13) — por eso no mira readOnlyCosteo/isValidacion.
  const canEditNombre = !!oppCols.find((c) => c.id === 'name')?.w;
  const [item, setItem] = useState<ItemDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Relectura contra Monday en curso (ver loadFresh). El ref evita que una
  // respuesta lenta de la oportunidad anterior pise la que se está viendo:
  // el drawer no se remonta al navegar entre oportunidades, solo cambia `id`.
  const [syncing, setSyncing] = useState(false);
  const currentIdRef = useRef(id);
  currentIdRef.current = id;
  const [tab, setTab] = useState<DrawerTabKey>(defaultTab as DrawerTabKey);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Pre-chequeo de costeo (todas las etapas): null = cargando; deshabilita el botón.
  const [costeoReady, setCosteoReady] = useState<{ ok: boolean; errors?: string[] } | null>(null);
  // Pre-chequeo de "Mandar a Validación de costeo" (board Costeo, etapa 15): cada
  // línea necesita su producto de catálogo confirmado por Compras (Descripción/Tallas
  // — Efraín 2026-07-18). null = cargando; deshabilita el botón.
  const [validacionReady, setValidacionReady] = useState<{ ok: boolean; errors?: string[] } | null>(null);
  const [versions, setVersions] = useState<QuoteVersionDTO[]>([]);
  const [showNuevaVersion, setShowNuevaVersion] = useState(false);
  const [duplicatingVersion, setDuplicatingVersion] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<QuoteVersionDTO | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);
  const [showEditInstitucion, setShowEditInstitucion] = useState(false);
  const [showEditCliente, setShowEditCliente] = useState(false);
  const [showEditVendedor, setShowEditVendedor] = useState(false);
  const [showEditComprador, setShowEditComprador] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // load() se llama sin esperar (onSaved tras cada write de la grid) — con
  // varias líneas seguidas (producto, color, cantidad) puede haber 2-3 GETs
  // en vuelo a la vez, y la red no garantiza que la respuesta MÁS VIEJA
  // llegue primero: una que salió antes pero tardó más podía resolver
  // DESPUÉS de una más nueva y pisar `item` con un snapshot anterior a la
  // última edición — se veía como "guardo un cambio y se regresa" (Efraín,
  // 2026-07-31). loadSeqRef descarta cualquier respuesta que no sea la del
  // load() más reciente que se haya llamado.
  const loadSeqRef = useRef(0);
  const load = () => {
    setError(null);
    const seq = ++loadSeqRef.current;
    getItemDetail('oportunidades', id)
      .then(({ item: it }) => {
        if (loadSeqRef.current !== seq) return;
        cacheSet(detailCache, id, it);
        setItem(it);
      })
      .catch(() => {
        if (loadSeqRef.current !== seq) return;
        setError('No se pudo cargar el detalle. Verifica tu acceso o que el servidor esté disponible.');
      });
  };
  // Parity con Monday al abrir (Efraín, 2026-07-30 — OPP-0795 salía con costos
  // en 0): `fresh` hace que el worker relea la oportunidad Y SUS LÍNEAS de
  // Monday antes de responder, en vez de servir el mirror D1 (que solo se
  // actualiza por webhook —con debounce que tira ráfagas— o cada 6h).
  // Va aparte de load() porque el round-trip a Monday tarda segundos: el drawer
  // se pinta ya con el mirror y estos datos lo reemplazan al llegar, con el
  // indicador "Verificando con Monday…" arriba mientras tanto.
  const loadFresh = () => {
    const reqId = id;
    setSyncing(true);
    return getItemDetail('oportunidades', reqId, { fresh: true })
      .then(({ item: it }) => {
        cacheSet(detailCache, reqId, it);
        if (currentIdRef.current === reqId) setItem(it);
      })
      .catch(() => { /* el mirror ya está pintado; no rompas la vista */ })
      .finally(() => { if (currentIdRef.current === reqId) setSyncing(false); });
  };
  const loadVersions = () => {
    getVersiones(id)
      .then((v) => { cacheSet(versionsCache, id, v); setVersions(v); })
      .catch(() => setVersions([]));
  };

  useEffect(() => {
    // Extremo inicial del "tiempo por tarea" (abrir el drawer → primer
    // guardado). El otro extremo lo pone `uxEdit` desde patchItem. Va en el
    // efecto de `id` y no en el montaje: el drawer NO se remonta al navegar
    // entre oportunidades, solo cambia `id` — con un [] aquí solo se contaría
    // la primera apertura de cada sesión.
    uxNav('drawer:open', { boardSlug: boardKey ?? 'oportunidades', itemId: Number(id) || undefined });
    // Pinta primero lo cacheado (o limpia si es una oportunidad nueva) y
    // refresca en background — apertura instantánea en re-visitas.
    setItem(detailCache.get(id) ?? null);
    setVersions(versionsCache.get(id) ?? []);
    load();
    // Toda apertura reconcilia contra Monday, sin importar qué tan fresco crea
    // estar el mirror (Efraín, 2026-07-30).
    loadFresh();
    loadVersions();
    // El drawer no se remonta al navegar de la oportunidad original a su
    // duplicado (mismo componente, solo cambia `id`) — sin esto "Duplicar"
    // se quedaría pegado en "Duplicando…" para la oportunidad nueva.
    setDuplicating(false);
  }, [id]);

  const stage = item?.cols.deal_stage ? statusIndex(item.cols.deal_stage) : undefined;

  // Evitar que den click: el check corre al abrir (y tras refrescar) y el botón
  // queda deshabilitado — en etapa 4 con los avisos ⚠ visibles por línea; después
  // de etapa 4 el server además exige una versión nueva sin costear (crear una
  // "Nueva versión" reactiva el botón — Efraín, 2026-07-17).
  //
  // Depende de `item` completo (no de `item?.syncedAt`): syncedAt es el mirror
  // de la OPORTUNIDAD y las correcciones típicas (producto/color/cantidad/ficha)
  // viven en las líneas (subitems), así que ese timestamp no avanzaba al
  // corregir una línea y el botón se quedaba pegado en deshabilitado aunque ya
  // no faltara nada — `load()` siempre entrega un objeto nuevo, así que basta
  // con re-correr en cada refetch (Efraín, 2026-07-21: bug reportado en Nueva
  // oportunidad).
  // Poll de respaldo cada 8s mientras no esté listo: algunas columnas que exige
  // el chequeo (ej. la ficha comercial, un mirror que Monday calcula después de
  // ligar el producto) tardan en sincronizar al mirror D1 sin que nada dispare
  // un refetch del lado del cliente — sin este poll el botón se quedaba
  // deshabilitado indefinidamente aunque el dato ya fuera válido en Monday
  // (Efraín, stress test 2026-07-21: nunca se reactivaba con 25 líneas hasta
  // recargar la página entera).
  useEffect(() => {
    if (!item || boardKey === 'validacion' || (boardKey === 'costeo' && stage !== '4')) { setCosteoReady(null); return; }
    let cancelled = false;
    let ready = false;
    const check = () => checkCosteo(id)
      .then(r => { if (cancelled) return; setCosteoReady(r); ready = r.ok; })
      .catch(() => { if (!cancelled) { setCosteoReady({ ok: true }); ready = true; } }); // el server re-valida al enviar
    check();
    const interval = setInterval(() => { if (!ready) check(); }, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id, stage, item, boardKey]);

  // Mismo patrón: corre solo donde aplica el botón (board Costeo, etapa 15) y se
  // vuelve a disparar en cada refetch de `item` — incluye el que dispara
  // CotizacionTab tras marcar/desmarcar una confirmación de Compras. También
  // hace poll de respaldo (ver nota arriba) porque "descripción y tallas
  // confirmadas" lo marca Compras desde el catálogo, no desde esta oportunidad.
  useEffect(() => {
    if (!item || stage !== '15' || (boardKey !== 'costeo' && boardKey !== 'zona_efrain')) { setValidacionReady(null); return; }
    let cancelled = false;
    let ready = false;
    const check = () => checkValidacion(id)
      .then(r => { if (cancelled) return; setValidacionReady(r); ready = r.ok; })
      .catch(() => { if (!cancelled) { setValidacionReady({ ok: true }); ready = true; } }); // el server re-valida al enviar
    check();
    const interval = setInterval(() => { if (!ready) check(); }, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id, stage, item, boardKey]);

  const showPostventa = stageAtOrAfter(stage, '9');
  const proyecto = useProyecto(id, !!item && showPostventa);

  const onRefresh = async () => {
    setRefreshing(true);
    // refreshItem ya baja item + líneas de Monday; loadFresh vuelve a leer el
    // mirror recién escrito (el worker se salta el segundo round-trip si acaba
    // de sincronizar) y deja el drawer con el estado exacto de Monday.
    try { await refreshItem('oportunidades', id); } catch { /* offline demo: ignore */ }
    await loadFresh();
    proyecto.reload();
    setRefreshing(false);
  };

  const onCopyLink = async () => {
    const url = `${window.location.origin}/${boardKey ?? 'oportunidades'}/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch { /* clipboard no disponible (http o sin permiso) */ }
  };

  // Mismo patrón de polling que CreateOportunidadModal: espera a que Monday
  // asigne el folio antes de navegar, así el drawer nuevo no abre "en blanco".
  const onDuplicate = async (etapa: string) => {
    setNotice(null);
    setDuplicating(true);
    try {
      const res = await duplicarOportunidad(id, etapa);
      if (!res.ok || !res.id) throw new Error(res.error ?? 'No se pudo duplicar la oportunidad.');
      const newId = res.id;
      let attempts = 0;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const detail = await getItemDetail('oportunidades', newId);
          if (detail.item.cols.pulse_id_mm0qcq0m?.text) break;
        } catch { /* reintentar */ }
        attempts++;
      }
      setShowDuplicar(false);
      onDuplicated(newId);
    } catch (e) {
      setNotice({ kind: 'error', title: 'No se pudo duplicar la oportunidad:', lines: [e instanceof Error ? e.message : 'Verifica tu conexión.'] });
      setDuplicating(false);
    }
  };

  // "+ Nueva versión" = duplicado literal de la vigente (Efraín, 2026-07-17: el
  // editor de draft era abrumador). El server archiva la vigente y resetea la
  // Etapa Costeo de las líneas — la copia queda editable inline como en Nueva
  // oportunidad y "Mandar a costeo" se reactiva.
  const onDuplicarVersion = async () => {
    setDuplicatingVersion(true);
    try {
      const res = await duplicarVersion(id);
      if (!res.ok) throw new Error(res.error ?? 'No se pudo crear la nueva versión.');
      const nueva = res.versions?.find((v) => v.status === 'vigente');
      if (res.versions) { cacheSet(versionsCache, id, res.versions); setVersions(res.versions); }
      setNotice({
        kind: 'ok', title: 'Nueva versión creada',
        lines: [
          `${nueva?.label ?? 'La nueva versión'} es una copia de la anterior — edítala como en Nueva oportunidad.`,
          'Cuando esté lista, usa "Mandar a costeo" para regresarla a costeo.',
        ],
      });
      load();
    } catch (e) {
      setNotice({ kind: 'error', title: 'No se pudo crear la nueva versión:', lines: [e instanceof Error ? e.message : 'Verifica tu conexión.'] });
    } finally {
      setDuplicatingVersion(false);
      setShowNuevaVersion(false);
    }
  };

  // "Restaurar esta versión": el server reescribe/crea/borra líneas hasta dejar
  // el mirror igual a la instantánea elegida (archivando antes la vigente) y todo
  // queda como borrador — cambiar de versión implica volver a pasar por costeo.
  const onRestaurarVersion = async () => {
    if (!restoreTarget) return;
    setRestoringVersion(true);
    try {
      const res = await restaurarVersion(id, restoreTarget.id);
      if (!res.ok) throw new Error(res.error ?? 'No se pudo restaurar la versión.');
      if (res.versions) { cacheSet(versionsCache, id, res.versions); setVersions(res.versions); }
      const nueva = res.versions?.find((v) => v.status === 'vigente');
      setNotice({
        kind: 'ok', title: `${restoreTarget.label} restaurada`,
        lines: [
          `${nueva?.label ?? 'La vigente'} ahora es la cotización tal como estaba en ${restoreTarget.label}; la anterior quedó archivada.`,
          'La oportunidad tiene que pasar por costeo otra vez — usa "Mandar a costeo" cuando esté lista.',
        ],
      });
      load();
    } catch (e) {
      setNotice({ kind: 'error', title: 'No se pudo restaurar la versión:', lines: [e instanceof Error ? e.message : 'Verifica tu conexión.'] });
    } finally {
      setRestoringVersion(false);
      setRestoreTarget(null);
    }
  };

  const onEnviarCosteo = async () => {
    setNotice(null);
    try {
      const res = await enviarCosteo(id);
      if (res.ok) {
        setNotice({ kind: 'ok', title: 'Solicitud de costeo enviada', lines: [res.folio ? `Se generó ${res.folio} y la etapa pasó a "En costeo".` : 'La etapa pasó a "En costeo".'] });
        load();
      } else {
        setNotice({ kind: 'error', title: 'No se puede mandar a costeo todavía:', lines: res.errors ?? ['No se pudo mandar a costeo.'] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se puede mandar a costeo todavía:', lines: ['No se pudo mandar a costeo. Verifica tu conexión.'] });
    }
  };

  const onEnviarValidacion = async () => {
    setNotice(null);
    try {
      const res = await enviarValidacion(id);
      if (res.ok) {
        setNotice({ kind: 'ok', title: 'Mandado a validación de costeo', lines: ['La etapa pasó a "Costeo en validación".'] });
        load();
      } else {
        setNotice({ kind: 'error', title: 'No se pudo mandar a validación:', lines: res.errors ?? ['No se pudo mandar a validación de costeo.'] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se pudo mandar a validación:', lines: ['Verifica tu conexión.'] });
    }
  };

  // Validar costeo (7 → 9 "Costeo Confirmado"): la aprobación de dirección al
  // Precio de Venta, paso previo a generar la cotización (Efraín, 2026-08-18).
  const onValidarCosteo = () => uxAction('drawer:validar-costeo', { boardSlug: 'oportunidades', itemId: Number(id) || undefined }, async () => {
    setNotice(null);
    try {
      const res = await validarCosteo(id);
      if (res.ok) {
        applyStageOptimistic('9');
        setNotice({ kind: 'ok', title: 'Costeo validado', lines: ['La etapa pasó a "Costeo Confirmado" y se avisó a Compras. Ya puedes generar la cotización.'] });
        load();
      } else {
        setNotice({ kind: 'error', title: 'No se pudo validar el costeo:', lines: res.errors ?? ['Verifica tu conexión.'] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se pudo validar el costeo:', lines: ['Verifica tu conexión.'] });
    }
  });

  const onGenerarCotizacion = async () => {
    setNotice(null);
    try {
      const res = await generarCotizacion(id);
      if (res.ok && !res.skipped) {
        setNotice({
          kind: 'ok', title: 'Cotización generada',
          lines: [`${String(res.folio_cotizacion ?? '')} · total $${Number(res.total ?? 0).toLocaleString()} — enviada a firma del vendedor.`],
        });
        load();
        loadVersions();
      } else {
        setNotice({ kind: 'error', title: 'No se generó la cotización:', lines: [String(res.reason ?? 'Revisa el update en Monday.')] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se generó la cotización:', lines: ['Verifica tu conexión.'] });
    }
  };

  // Pinta la nueva etapa de inmediato en `item` (deriva `stage` y con él los
  // botones Perder/Ganar/Archivar y demás condicionales) — el mirror en D1
  // solo se actualiza cuando llega el echo de Monday, así que sin esto load()
  // seguía devolviendo la etapa vieja y el botón que se acababa de usar
  // no desaparecía (Efraín, 2026-07-21).
  const applyStageOptimistic = (idx: string) => {
    setItem((cur) => cur ? {
      ...cur,
      cols: { ...cur.cols, deal_stage: { ...cur.cols.deal_stage, text: DEAL_STAGE_LABELS[idx] ?? cur.cols.deal_stage?.text ?? '', value: { index: Number(idx) } } },
    } : cur);
  };

  const onCancelarOportunidad = () => uxAction('drawer:cancelar-oportunidad', { boardSlug: 'oportunidades', itemId: Number(id) || undefined }, async () => {
    setNotice(null);
    try {
      const res = await patchItem('oportunidades', id, { deal_stage: DEAL_STAGE_LABELS['5'] });
      if (res.ok) {
        applyStageOptimistic('5');
        setNotice({ kind: 'ok', title: 'Oportunidad cancelada', lines: ['La etapa pasó a "Cancelada".'] });
        load();
      } else {
        setNotice({ kind: 'error', title: 'No se pudo cancelar la oportunidad:', lines: [res.error ?? 'Verifica tu conexión.'] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se pudo cancelar la oportunidad:', lines: ['Verifica tu conexión.'] });
    }
  });

  // Reabrir: sin historial de etapa previa en el mirror (ni D1 ni Monday
  // guardan de dónde venía al cancelar/perder), así que siempre regresa a
  // "Nueva oportunidad" — mismo destino para las tres etapas cerradas
  // (Efraín, 2026-08-13).
  const onReabrirOportunidad = () => uxAction('drawer:reabrir-oportunidad', { boardSlug: 'oportunidades', itemId: Number(id) || undefined }, async () => {
    setNotice(null);
    try {
      const res = await patchItem('oportunidades', id, { deal_stage: DEAL_STAGE_LABELS['4'] });
      if (res.ok) {
        applyStageOptimistic('4');
        setNotice({ kind: 'ok', title: 'Oportunidad reabierta', lines: ['La etapa pasó a "Nueva oportunidad".'] });
        load();
      } else {
        setNotice({ kind: 'error', title: 'No se pudo reabrir la oportunidad:', lines: [res.error ?? 'Verifica tu conexión.'] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se pudo reabrir la oportunidad:', lines: ['Verifica tu conexión.'] });
    }
  });

  const onPerderOportunidad = () => uxAction('drawer:perder-oportunidad', { boardSlug: 'oportunidades', itemId: Number(id) || undefined }, async () => {
    setNotice(null);
    try {
      const res = await patchItem('oportunidades', id, { deal_stage: DEAL_STAGE_LABELS['2'] });
      if (res.ok) {
        applyStageOptimistic('2');
        setNotice({ kind: 'ok', title: 'Oportunidad perdida', lines: ['La etapa pasó a "Perdida".'] });
        load();
      } else {
        setNotice({ kind: 'error', title: 'No se pudo marcar como perdida:', lines: [res.error ?? 'Verifica tu conexión.'] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se pudo marcar como perdida:', lines: ['Verifica tu conexión.'] });
    }
  });

  const onGanarOportunidad = () => uxAction('drawer:ganar-oportunidad', { boardSlug: 'oportunidades', itemId: Number(id) || undefined }, async () => {
    setNotice(null);
    try {
      const res = await ganarOportunidad(id);
      if (res.ok) {
        applyStageOptimistic('1');
        setNotice({ kind: 'ok', title: 'Oportunidad ganada', lines: ['La etapa pasó a "Ganada" y se creó el Proyecto.'] });
        load();
      } else {
        setNotice({ kind: 'error', title: 'No se pudo marcar como ganada:', lines: [res.error ?? 'Verifica tu conexión.'] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se pudo marcar como ganada:', lines: ['Verifica tu conexión.'] });
    }
  });

  if (error) return <div style={{ padding: 32, color: 'var(--ink-quiet)' }}>{error}</div>;
  if (!item) return <div style={{ padding: 32 }}>Cargando…</div>;

  const products = item.children ?? [];

  const showProyectos = stageAtOrAfter(stage, '8');
  const activeTab = (tab === 'documentacion' || tab === 'tallas') && !showPostventa ? 'cotizacion'
    : (tab === 'ordenes' || tab === 'ejecucion' || tab === 'logistica') && !showProyectos ? 'cotizacion'
    : tab;
  const cotizacionVariant = boardKey && COSTEO_VARIANT_BOARDS.includes(boardKey) ? 'costeo' : 'venta';
  // Board Costeo = solo lectura para producto/color/cantidad/embellecimiento y
  // nuevos productos (trabajo de Ventas en Oportunidades); Compras solo captura
  // costos + Etapa Costeo y avanza a Validación (Efraín, 2026-07-16). Excepción:
  // en Nueva oportunidad (stage 4) Compras puede mandar a costeo igual que
  // Ventas — la oportunidad todavía no tiene dueño de costeo (Efraín, 2026-08-10).
  const readOnlyCosteo = boardKey === 'costeo' && stage !== '4';
  const isValidacion = boardKey === 'validacion';
  // Zona Efrain = Costeo + Validación en la misma pantalla (Efraín, 2026-08-18:
  // "debe ser igual que COSTEO y VALIDACION COSTEO, es una combinación de los
  // dos"). El reparto Ventas/Compras/dirección que justifica los candados de
  // esos dos boards no existe en la zona privada: la misma persona captura las
  // líneas, los costos y el Precio de Venta, así que aquí se abre todo lo que
  // su rol ya puede escribir en el server (no relaja ningún permiso: precio y
  // costos siguen filtrados por shared/visibility.ts) y aparece también el
  // botón de "Mandar a Validación de costeo", que solo vivía en el board Costeo.
  const zonaPrivada = boardKey === 'zona_efrain';
  // Condiciones de la cotización (comerciales/entrega/vigencia): las llena
  // Compras en el board Costeo — no aplica en Oportunidades ni en el resto
  // de los boards de pipeline (Efraín, 2026-07-30).
  const showCondiciones = (readOnlyCosteo || zonaPrivada) && (me?.role === 'compras' || me?.role === 'admin');
  // Board Validación Costeo = lo ÚNICO editable es Precio de Venta; todo lo
  // demás (líneas, embellecimientos, nuevos productos, costos) es solo lectura
  // (Efraín, 2026-07-16).
  // Solo la ve porque lidera la zona de su dueño (ItemDetailDTO.ownedByViewer,
  // worker/lib/zonas.ts): se apaga TODO lo que escribe. No es cosmético — el
  // server responde 404 a cualquier write sobre una oportunidad ajena.
  const ajena = item.ownedByViewer === false;
  const noLineEdits = readOnlyCosteo || isValidacion || ajena;
  // "+ Nueva versión"/"Restaurar versión": el server las permite en CUALQUIER
  // etapa, incluidas Ganada/Perdida (worker/lib/quoteVersions.ts, Efraín
  // 2026-08-14: sí hay casos reales de modificar una cotización ya cerrada),
  // y sin mirar boardKey (duplicateVersion/restoreVersion no tienen candado
  // de board). readOnlyCosteo NO debe apagarlas: bloquea la edición INLINE de
  // producto/color/cantidad desde Costeo (trabajo de Ventas), pero versionar
  // es una acción de archivo aparte — impedirla ahí dejaba una vigente ya
  // costeada sin ninguna vía de cambio al abrir el item desde el board Costeo
  // (Efraín, 2026-08-14: "ya tiene cotización y no puedo crear una V2 es
  // absurdo"). Validación sigue bloqueada (ahí lo único editable es Precio
  // de Venta).
  const canVersion = !isValidacion && !ajena;
  // Embellecimientos (tab aparte): a diferencia del resto de la línea, Compras
  // SÍ captura/edita zonas e imágenes desde el board Costeo (Efraín, 2026-08-12)
  // — por eso no hereda readOnlyCosteo. Validación y oportunidad ajena se
  // mantienen de solo lectura igual que el resto de la línea.
  const embellReadOnly = isValidacion || ajena;

  // checkCosteo mete primero los errores de la oportunidad (institución, sin
  // líneas) y luego los de cada línea (prefijo "#1 ..." — ver validateLinea en
  // worker/lib/costeo.ts). Los de línea ya se ven como banner ⚠ en la fila
  // (QuoteRow); los de oportunidad no tienen dónde aparecer si no es aquí, y
  // "Institución" es un mirror de Cliente — con Cliente vacío, este es el único
  // aviso visible de que falta asignarlo (Efraín, 2026-08-10: se veía
  // deshabilitado sin ninguna pista).
  const costeoItemErrors = costeoReady && !costeoReady.ok ? (costeoReady.errors ?? []).filter(e => !e.startsWith('#')) : [];

  // Borrador de versión: la vigente aún no se costea (todas las líneas con Etapa
  // Costeo vacía/"No iniciado" — recién duplicada con "+ Nueva versión" o líneas
  // nuevas). Desbloquea la edición inline del grid igual que Nueva oportunidad y
  // oculta el chip de duplicar (no hay nada costeado que archivar).
  const draftVigente = stage !== '4' && products.length > 0 && products.every((p) => {
    const etapa = (p.cols[ETAPA_COSTEO_COL]?.text ?? '').trim();
    return !etapa || etapa === 'No iniciado';
  });
  const vigenteLabel = versions.find((v) => v.status === 'vigente')?.label;

  // Generar cotización (etapa 7): cmp-tallas la omite si ningún producto tiene
  // precio — mejor deshabilitar el botón desde aquí con la razón visible.
  const hasPrecio = products.some(p => (Number((p.cols[PRECIO_COL]?.text ?? '').replace(/,/g, '')) || 0) > 0);

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ padding: isMobile ? '14px 14px 0' : '20px 32px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', color: 'var(--ink-secondary)', font: 'var(--text-label-strong)' }}>
          <IconBack /> {backLabel}
        </div>
        {canDuplicate && !ajena && (
          <div
            onClick={duplicating ? undefined : () => setShowDuplicar(true)}
            title="Crea una oportunidad nueva con los mismos productos vigentes, embellecimientos y costeo (sin cotizaciones ni documentos)"
            style={{
              font: 'var(--text-label-strong)', color: 'var(--accent)',
              cursor: duplicating ? 'default' : 'pointer', opacity: duplicating ? 0.6 : 1,
            }}
          >
            {duplicating ? 'Duplicando…' : 'Duplicar'}
          </div>
        )}
      </div>

      {/* En cel el header se apila: meta arriba y botones de acción abajo a lo
          ancho — en un solo renglón los botones se salían de la pantalla. */}
      <div style={{
        display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between',
        flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0,
        padding: isMobile ? '12px 14px 16px' : '16px 32px 20px', borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <EditableItemName
              slug="oportunidades"
              itemId={id}
              name={item.name}
              canEdit={canEditNombre && !ajena}
              font="var(--text-subtitle)"
              onRenamed={(nombre) => setItem((cur) => {
                if (!cur) return cur;
                const next = { ...cur, name: nombre };
                cacheSet(detailCache, id, next);
                return next;
              })}
            />
            {item.cols.deal_stage?.text && (() => {
              const dealStageCol = oppCols.find((c) => c.id === 'deal_stage');
              const { color, tint } = dealStageCol ? chipFor(dealStageCol, item.cols.deal_stage) : { color: 'var(--ink-quiet)', tint: 'var(--bg-sunken)' };
              return <StatusBadge label={item.cols.deal_stage.text} color={color} tint={tint} />;
            })()}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 4, font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
            <span>Institución: <span style={{ color: 'var(--ink-secondary)' }}>{item.cols[INSTITUCION_COL]?.text || '—'}</span></span>
            {canEditInstitucion && !ajena && <ChangeIconButton label="Cambiar institución" onClick={() => setShowEditInstitucion(true)} />}
            <span>·</span>
            <span>
              Cliente: <span style={{ color: 'var(--ink-secondary)' }}>{item.cols[CONTACTO_COL]?.text || '—'}</span>
            </span>
            {canEditCliente && !ajena && <ChangeIconButton label="Cambiar cliente" onClick={() => setShowEditCliente(true)} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 4, font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>
            {/* Mientras corre la relectura contra Monday el "sincronizado hace X"
                mentiría — se muestra el estado real de la verificación. */}
            {syncing
              ? <span style={{ color: 'var(--accent)' }}>⟳ verificando con Monday…</span>
              : <SyncIndicator syncedAt={item.syncedAt} pending={item.pendingWrite ? 1 : 0} />}
            <span>·</span>
            <span>
              Vendedor: <span style={{ color: 'var(--ink-tertiary)' }}>{item.cols[VENDEDOR_COL]?.text || '—'}</span>
            </span>
            {canEditVendedor && !ajena && <ChangeIconButton label="Cambiar vendedor" onClick={() => setShowEditVendedor(true)} />}
            <span>·</span>
            <span>
              Comprador: <span style={{ color: 'var(--ink-tertiary)' }}>{item.cols[COMPRAS_COL]?.text || '—'}</span>
            </span>
            {canEditComprador && !ajena && <ChangeIconButton label="Cambiar comprador" onClick={() => setShowEditComprador(true)} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* Siempre visible (salvo boards de Compras): las cotizaciones cambian
              mucho — en cualquier etapa el vendedor puede crear una nueva versión
              y regresarla a costeo con este botón. Deshabilitado cuando la vigente
              ya se costeó o la etapa lo bloquea (Efraín, 2026-07-17). */}
          {!readOnlyCosteo && !isValidacion && !ajena && (
            <ConfirmButton
              label="Mandar a costeo"
              confirmLabel="¿Enviar solicitud de costeo?"
              busyLabel="Validando y generando PDF… puede tardar unos minutos, no cierres esta pantalla"
              disabled={costeoReady === null || !costeoReady.ok}
              title={costeoReady === null ? 'Verificando requisitos…'
                : !costeoReady.ok ? (costeoItemErrors[0] ?? (stage === '4' ? 'Faltan requisitos — revisa los avisos ⚠ en cada línea' : (costeoReady.errors?.[0] ?? 'No disponible todavía')))
                : 'Genera el PDF de solicitud y pasa a "En costeo"'}
              onConfirm={onEnviarCosteo}
            />
          )}
          {stage === '15' && (readOnlyCosteo || zonaPrivada) && !ajena && (
            <ConfirmButton
              label="Mandar a Validación de costeo"
              confirmLabel="¿Mandar a validación de costeo?"
              busyLabel="Mandando a validación…"
              disabled={validacionReady === null || !validacionReady.ok}
              title={validacionReady === null ? 'Verificando requisitos…'
                : !validacionReady.ok ? 'Faltan confirmaciones de Compras — revisa los avisos ⚠ en cada línea'
                : "Pasa la etapa a 'Costeo en validación'"}
              onConfirm={onEnviarValidacion}
            />
          )}
          {/* Validar costeo (etapa 7): la cotización ya NO sale de aquí — primero
              dirección aprueba el precio (7→9) y hasta entonces aparece
              "Generar cotización" (Efraín, 2026-08-18: "el botón de generar
              cotización no debe aparecer ahí, solo validar costeo; ya después
              se genera la cotización"). Solo admin: es la aprobación del
              Precio de Venta, la única columna que solo admin escribe. */}
          {stage === '7' && me?.role === 'admin' && !ajena && (
            <ConfirmButton
              label="Validar costeo"
              confirmLabel="¿Validar el costeo y confirmar el precio?"
              busyLabel="Validando…"
              disabled={!hasPrecio}
              title={hasPrecio ? 'Pasa a "Costeo Confirmado" y avisa a Compras — después se genera la cotización' : 'Ningún producto tiene Precio de Venta — captúralo antes de validar'}
              onConfirm={onValidarCosteo}
            />
          )}
          {stage === '9' && !ajena && (
            <ConfirmButton
              label="Generar cotización"
              confirmLabel="¿Generar y mandar a firma?"
              busyLabel="Generando cotización… puede tardar unos minutos, no cierres esta pantalla"
              disabled={!hasPrecio}
              title={hasPrecio ? 'PDFs con y sin precio + firma del vendedor (DocuSeal)' : 'Ningún producto tiene Precio de Venta — captúralo antes de cotizar'}
              onConfirm={onGenerarCotizacion}
            />
          )}
          {stage && !['1', '2', '5'].includes(stage) && !ajena && (
            <>
              {stage !== '4' && (
                <ConfirmButton
                  label="Perder"
                  confirmLabel="¿Marcar como perdida?"
                  busyLabel="Marcando…"
                  onConfirm={onPerderOportunidad}
                  style={{ fontSize: '11px', padding: '6px 11px' }}
                />
              )}
              {/* Desde "Costeo Confirmado", no desde "Cotización": Monday ordena
                  Cotización DESPUÉS de Costeo Confirmado, así que el umbral en
                  '6' dejaba sin botón "Ganar" justo a las oportunidades ya
                  costeadas y confirmadas (Efraín, 2026-08-14). */}
              {stageAtOrAfter(stage, '9') && (
                <ConfirmButton
                  label="Ganar"
                  confirmLabel="¿Marcar como ganada?"
                  busyLabel="Marcando…"
                  onConfirm={onGanarOportunidad}
                  style={{ fontSize: '11px', padding: '6px 11px' }}
                />
              )}
              <ConfirmButton
                label="Archivar"
                confirmLabel="¿Archivar esta oportunidad?"
                busyLabel="Archivando…"
                onConfirm={onCancelarOportunidad}
                style={{ fontSize: '11px', padding: '6px 11px' }}
              />
            </>
          )}
          {stage && ['1', '2', '5'].includes(stage) && !ajena && (
            <ConfirmButton
              label="Reabrir"
              confirmLabel="¿Reabrir esta oportunidad?"
              busyLabel="Reabriendo…"
              onConfirm={onReabrirOportunidad}
              style={{ fontSize: '11px', padding: '6px 11px' }}
            />
          )}
          <Button variant="secondary" onClick={onCopyLink}>
            <IconLink /> {linkCopied ? 'Copiado' : 'Copiar link'}
          </Button>
          <Button variant="secondary" onClick={onRefresh}>{refreshing ? 'Actualizando…' : 'Actualizar'}</Button>
        </div>
      </div>

      {notice && (
        <div style={{
          margin: isMobile ? '12px 14px 0' : '14px 32px 0', padding: '12px 16px',
          border: `1px solid ${notice.kind === 'ok' ? 'var(--status-ganada)' : 'var(--status-perdida)'}`,
          borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
        }}>
          <div style={{ font: 'var(--text-label-strong)', color: notice.kind === 'ok' ? 'var(--status-ganada)' : 'var(--status-perdida)', marginBottom: 6 }}>
            {notice.title}
          </div>
          {notice.lines.map((e, i) => (
            <div key={i} style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 2 }}>• {e}</div>
          ))}
        </div>
      )}

      {/* El botón deshabilitado por sí solo no dice por qué — sobre todo cuando
          el motivo es de la oportunidad (falta institución/cliente) y no hay
          ninguna línea con aviso ⚠ que lo delate (Efraín, 2026-08-10). */}
      {!readOnlyCosteo && !isValidacion && !ajena && costeoItemErrors.length > 0 && (
        <div style={{
          margin: isMobile ? '12px 14px 0' : '14px 32px 0', padding: '12px 16px',
          border: '1px solid var(--status-perdida)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
        }}>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--status-perdida)', marginBottom: 6 }}>
            Falta esto para "Mandar a costeo":
          </div>
          {costeoItemErrors.map((e, i) => (
            <div key={i} style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 2 }}>• {e}</div>
          ))}
        </div>
      )}

      {/* Sin este aviso, una oportunidad de la zona se ve idéntica a una propia
          pero sin botones — parecería que el portal se rompió. */}
      {ajena && (
        <div style={{
          margin: isMobile ? '12px 14px 0' : '14px 32px 0', padding: '10px 14px',
          borderRadius: 'var(--radius-lg)', background: 'var(--bg-sunken)',
          border: '1px solid var(--border)', font: 'var(--text-label)', color: 'var(--ink-secondary)',
        }}>
          Solo lectura — esta oportunidad es de{' '}
          <span style={{ color: 'var(--ink)' }}>{item.cols[VENDEDOR_COL]?.text || 'otro vendedor'}</span>
          {' '}y la ves porque lideras su zona.
        </div>
      )}

      <BoardTabsBar active={activeTab} onChange={setTab} showPostventa={showPostventa} showProyectos={showProyectos} />

      {/* Una vez existe el Proyecto (Ganada), la conversación post-venta vive
          en su feed de Monday, no en el de la Oportunidad (Efraín, 2026-07-17). */}
      {activeTab === 'actualizaciones' && (
        proyecto.proyecto
          ? <ActualizacionesTab slug="proyectos" itemId={proyecto.proyecto.id} />
          : <ActualizacionesTab slug="oportunidades" itemId={id} />
      )}
      {activeTab === 'cotizacion' && (
        <CotizacionTab
          // Remount cuando cambia el número de versiones (duplicar/restaurar):
          // resetea la selección interna de chips y regresa la vista a la vigente.
          key={`cot-${versions.length}`}
          subCols={subCols} oppCols={oppCols} products={products} variant={cotizacionVariant} onSaved={load} versions={versions}
          onVersioned={(v) => {
            cacheSet(versionsCache, id, v);
            setVersions(v);
            const nueva = v.find((x) => x.status === 'vigente');
            setNotice({
              kind: 'ok', title: 'Línea eliminada — nueva versión creada',
              lines: [
                `${nueva?.label ?? 'La nueva versión'} es una copia de la anterior sin esa línea — edítala como en Nueva oportunidad.`,
                'Cuando esté lista, usa "Mandar a costeo" para regresarla a costeo.',
              ],
            });
          }}
          // Ya no excluye Ganada/Perdida (Efraín, 2026-08-14): tras "+ Nueva
          // versión" la vigente queda en borrador igual que en cualquier otra
          // etapa, y ese borrador debe poder editarse inline — mismo criterio
          // que EmbellecimientosTab (`!ajena`, ver abajo).
          editable={!ajena}
          onNuevaVersion={canVersion && stage !== '4' && !draftVigente ? () => setShowNuevaVersion(true) : undefined}
          onRestoreVersion={canVersion ? (v) => setRestoreTarget(v) : undefined}
          stage={stage}
          draft={draftVigente}
          oppId={id}
          item={item}
          readOnly={readOnlyCosteo || ajena}
          precioOnly={isValidacion}
          showCondiciones={showCondiciones}
          zonaPrivada={zonaPrivada && !ajena}
        />
      )}
      {activeTab === 'embellecimientos' && (
        <EmbellecimientosTab
          subCols={subCols} products={products} versions={versions} onSaved={load}
          editable={!ajena}
          onNuevaVersion={canVersion && stage !== '4' && !draftVigente ? () => setShowNuevaVersion(true) : undefined}
          readOnly={embellReadOnly}
        />
      )}
      {activeTab === 'nuevosproductos' && <NuevosProductosTab oppId={id} readOnly={noLineEdits} />}
      {activeTab === 'actividad' && <ActividadTab slug="oportunidades" itemId={id} />}
      {activeTab === 'documentacion' && <DocumentacionTab item={item} proyecto={showPostventa ? proyecto : undefined} />}
      {activeTab === 'tallas' && <TallasTab subCols={subCols} products={products} proyecto={showPostventa ? proyecto : undefined} />}
      {activeTab === 'ordenes' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 4 }}>Órdenes de compra a proveedores</div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>Cuando se mandan de CMP a los proveedores.</div>
          <PaymentRequestButton slug="oportunidades" itemId={id} kind="proveedor" />
          <ProyectoOrdenesSection state={proyecto} oppId={id} />
        </div>
      )}
      {activeTab === 'ejecucion' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <EjecucionSection state={proyecto} oppId={id} />
        </div>
      )}
      {activeTab === 'logistica' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <LogisticaSection state={proyecto} oppId={id} />
        </div>
      )}

      {showNuevaVersion && (
        <Modal
          title="Nueva versión de la cotización"
          onClose={() => { if (!duplicatingVersion) setShowNuevaVersion(false); }}
          width={480}
          footer={
            <>
              <Button variant="ghost" onClick={() => { if (!duplicatingVersion) setShowNuevaVersion(false); }}>Cancelar</Button>
              <Button variant="primary" onClick={duplicatingVersion ? undefined : onDuplicarVersion} style={duplicatingVersion ? { opacity: 0.6 } : undefined}>
                {duplicatingVersion ? 'Duplicando…' : 'Duplicar cotización'}
              </Button>
            </>
          }
        >
          <div style={{ font: 'var(--text-body)', color: 'var(--ink-secondary)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              Se crea una copia exacta de {vigenteLabel ?? 'la cotización vigente'} y la actual queda archivada.
            </div>
            <div>
              La copia se puede editar directo en la tabla (productos, colores, cantidades y embellecimientos,
              igual que en Nueva oportunidad).
            </div>
            <div style={{ color: 'var(--status-esperando)', font: 'var(--text-label-strong)' }}>
              ⚠ Al cambiar de versión, la oportunidad tiene que pasar por costeo otra vez:
              la versión nueva nace sin costear y se manda con «Mandar a costeo».
            </div>
          </div>
        </Modal>
      )}

      {showDuplicar && (
        <DuplicarOportunidadModal
          onClose={() => setShowDuplicar(false)}
          onConfirm={onDuplicate}
          duplicating={duplicating}
        />
      )}

      {restoreTarget && (
        <Modal
          title={`Restaurar ${restoreTarget.label}`}
          onClose={() => { if (!restoringVersion) setRestoreTarget(null); }}
          width={480}
          footer={
            <>
              <Button variant="ghost" onClick={() => { if (!restoringVersion) setRestoreTarget(null); }}>Cancelar</Button>
              <Button variant="primary" onClick={restoringVersion ? undefined : onRestaurarVersion} style={restoringVersion ? { opacity: 0.6 } : undefined}>
                {restoringVersion ? 'Restaurando…' : `Restaurar ${restoreTarget.label}`}
              </Button>
            </>
          }
        >
          <div style={{ font: 'var(--text-body)', color: 'var(--ink-secondary)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              La cotización regresa a como estaba en {restoreTarget.label}: se reescriben las líneas
              (las que no existían en esa versión se eliminan) y la vigente actual queda archivada.
            </div>
            <div style={{ color: 'var(--status-esperando)', font: 'var(--text-label-strong)' }}>
              ⚠ Al cambiar de versión, la oportunidad tiene que pasar por costeo otra vez:
              la versión restaurada queda sin costear y se manda con «Mandar a costeo».
            </div>
          </div>
        </Modal>
      )}

      {showEditInstitucion && (
        <EditInstitucionModal
          oppId={id}
          oppName={item.name}
          currentInstitucion={item.cols[INSTITUCION_COL]?.text || ''}
          currentCliente={item.cols[CONTACTO_COL]?.text || ''}
          onClose={() => setShowEditInstitucion(false)}
          // El espejo de Monday se recalcula diferido y sin webhook (el worker
          // ya lo adelantó en D1); el nombre que regresa el POST se pinta aquí
          // mismo para que el header no quede en el valor viejo.
          onSaved={(institucion) => {
            setItem((cur) => {
              if (!cur) return cur;
              const next = { ...cur, cols: { ...cur.cols, [INSTITUCION_COL]: { ...cur.cols[INSTITUCION_COL], type: cur.cols[INSTITUCION_COL]?.type ?? 'mirror', text: institucion } } };
              cacheSet(detailCache, id, next);
              return next;
            });
            load();
          }}
        />
      )}

      {showEditCliente && (
        <EditClienteModal
          oppId={id}
          oppName={item.name}
          currentCliente={item.cols[CONTACTO_COL]?.text || ''}
          onClose={() => setShowEditCliente(false)}
          onSaved={load}
        />
      )}

      {showEditVendedor && (
        <EditPersonaModal
          oppId={id}
          oppName={item.name}
          colId={VENDEDOR_COL}
          role="vendedor"
          label="Vendedor"
          currentName={item.cols[VENDEDOR_COL]?.text || ''}
          onClose={() => setShowEditVendedor(false)}
          onSaved={load}
        />
      )}

      {showEditComprador && (
        <EditPersonaModal
          oppId={id}
          oppName={item.name}
          colId={COMPRAS_COL}
          role="compras"
          label="Comprador"
          currentName={item.cols[COMPRAS_COL]?.text || ''}
          onClose={() => setShowEditComprador(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
