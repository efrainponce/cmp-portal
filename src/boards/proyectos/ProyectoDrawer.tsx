// Drawer del Proyecto (post-venta), abierto siempre por su propio id — nunca
// depende del board_relation hacia la Oportunidad (ver worker/lib/dal.ts).
// Reusa ProyectoTallasSection/ProyectoOrdenesSection/OcContratoSection tal
// cual (mismo contrato ProyectoState, solo que aquí se construye directo del
// item ya cargado, sin pasar por la Oportunidad). Cotización/Embellecimientos
// se quedan del lado de la Oportunidad — solo un link cruzado, para no
// duplicar el estado de versiones (Efraín, 2026-07-17: "solo trae la info de
// los proyectos y listo").
import { useEffect, useState } from 'react';
import { Button } from '../../components/core/Button';
import { IconBack } from '../../components/icons';
import { SyncIndicator } from '../../components/board/SyncIndicator';
import { getItemDetail, refreshItem, getProyectoOportunidad, type ItemDetailDTO } from '../../lib/api';
import { useIsMobile } from '../../lib/useIsMobile';
import { useMe } from '../../lib/useMe';
import { ActualizacionesTab } from '../oportunidades/tabs/ActualizacionesTab';
import { EmptyDocTab } from '../oportunidades/tabs/EmptyDocTab';
import { OcContratoSection } from '../oportunidades/tabs/DocumentacionTab';
import { ProyectoTallasSection, ProyectoOrdenesSection, type ProyectoState } from '../oportunidades/ProyectoSection';
import { AgregarLineaModal } from './AgregarLineaModal';

type ProyectoTabKey = 'actualizaciones' | 'documentacion' | 'tallas' | 'ordenes' | 'logistica';

const FOLIO_COL = 'pulse_id_mm1a12gy';
const INSTITUCION_COL = 'lookup_mm1dwn6';
const FECHA_ENTREGA_COL = 'date_mm0m1vfv';
const VENDEDOR_COL = 'multiple_person_mm0hrnqq';

const TABS: { key: ProyectoTabKey; label: string }[] = [
  { key: 'actualizaciones', label: 'Actualizaciones' },
  { key: 'documentacion', label: 'Documentación' },
  { key: 'tallas', label: 'Tallas' },
  { key: 'ordenes', label: 'Órdenes de compra' },
  { key: 'logistica', label: 'Logística' },
];

interface Props {
  id: string;
  backLabel: string;
  defaultTab: string;
  onBack: () => void;
  /** Abre la Oportunidad ligada en su propio drawer (cotización/embellecimientos viven ahí). */
  onOpenOportunidad: (id: string) => void;
}

// SWR de sesión — mismo patrón que OpportunityDrawer.
const detailCache = new Map<string, ItemDetailDTO>();

export function ProyectoDrawer({ id, backLabel, defaultTab, onBack, onOpenOportunidad }: Props) {
  const isMobile = useIsMobile();
  const me = useMe();
  const canAgregarLinea = me?.role === 'compras' || me?.role === 'admin';
  const [item, setItem] = useState<ItemDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<ProyectoTabKey>(defaultTab as ProyectoTabKey);
  const [oportunidadId, setOportunidadId] = useState<string | null>(null);
  const [showAgregarLinea, setShowAgregarLinea] = useState(false);

  const load = () => {
    setError(null);
    getItemDetail('proyectos', id)
      .then(({ item: it }) => { detailCache.set(id, it); setItem(it); })
      .catch(() => setError('No se pudo cargar el proyecto. Verifica tu acceso o que el servidor esté disponible.'));
  };

  useEffect(() => {
    setItem(detailCache.get(id) ?? null);
    setTab(defaultTab as ProyectoTabKey);
    setOportunidadId(null);
    load();
    getProyectoOportunidad(id).then(setOportunidadId).catch(() => setOportunidadId(null));
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
            <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>{item.name}</div>
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
        {oportunidadId && (
          <div
            onClick={() => onOpenOportunidad(oportunidadId)}
            style={{ marginTop: 8, font: 'var(--text-label-strong)', color: 'var(--accent)', cursor: 'pointer', width: 'fit-content' }}
          >
            Ver Oportunidad ligada (cotización, embellecimientos) ↗
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, padding: isMobile ? '0 14px' : '0 32px', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <div
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '12px 4px', marginRight: 14, font: "600 13px 'Inter', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap',
              color: tab === t.key ? 'var(--ink)' : 'var(--ink-quiet)',
              borderBottom: '2px solid ' + (tab === t.key ? 'var(--accent)' : 'transparent'),
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {tab === 'actualizaciones' && <ActualizacionesTab slug="proyectos" itemId={id} />}
      {tab === 'documentacion' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <OcContratoSection proyecto={proyectoState} oppId={oportunidadId} />
        </div>
      )}
      {tab === 'tallas' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          {canAgregarLinea && (
            <Button variant="secondary" onClick={() => setShowAgregarLinea(true)}>
              + Agregar línea manual
            </Button>
          )}
          <ProyectoTallasSection state={proyectoState} oppId={oportunidadId} />
        </div>
      )}
      {tab === 'ordenes' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <ProyectoOrdenesSection state={proyectoState} oppId={oportunidadId} />
        </div>
      )}
      {tab === 'logistica' && (
        <EmptyDocTab
          title="Documentos de logística"
          subtitle="Guías de embarque, comprobantes de entrega y documentación de envío."
          uploadLabel="Subir documento de logística"
        />
      )}

      {showAgregarLinea && (
        <AgregarLineaModal
          proyectoId={id}
          onClose={() => setShowAgregarLinea(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
