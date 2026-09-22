// Tab "Muestras" del drawer de la Oportunidad y del Proyecto (Efraín,
// 2026-09-21). Cada solicitud cuelga de UN item — el de este drawer — igual
// que las órdenes de compra. Nativo en D1 (worker/lib/muestras.ts): nada de
// esto va a Monday.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMuestrasDe } from '../../lib/muestrasApi';
import { Button } from '../../components/core/Button';
import { MuestraModal } from './MuestraModal';
import { SolicitudGrupo } from './SolicitudCard';
import type { MuestraPadre, MuestraSolicitudDTO } from '../../../shared/muestras';

interface Props {
  padre: MuestraPadre;
  itemId: string;
  /** false = el drawer ya es de solo lectura (oportunidad ajena). */
  readOnly?: boolean;
}

export function MuestrasTab({ padre, itemId, readOnly = false }: Props) {
  const [data, setData] = useState<{ solicitudes: MuestraSolicitudDTO[]; editable: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setData(await getMuestrasDe(padre, itemId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las muestras.');
    }
  }, [padre, itemId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const editable = !readOnly && !!data?.editable;
  // Una tarjeta por solicitud, con sus versiones adentro; la más reciente arriba.
  const grupos = useMemo(() => {
    const m = new Map<string, MuestraSolicitudDTO[]>();
    for (const s of data?.solicitudes ?? []) m.set(s.grupoId, [...(m.get(s.grupoId) ?? []), s]);
    return [...m.values()].sort((a, b) => Number(b[0].grupoId) - Number(a[0].grupoId));
  }, [data]);

  return (
    <div style={{ padding: '24px clamp(12px, 3vw, 32px) 40px', width: '100%', maxWidth: 1100, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 4 }}>Solicitudes de muestra</div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
            Arma la solicitud (producto, color, talla y cantidad) y usa «Enviar a Compras»: se publica en Actualizaciones y a Compras le llega el aviso por WhatsApp.
          </div>
        </div>
        {editable && <Button variant="primary" onClick={() => setNueva(true)}>+ Nueva solicitud</Button>}
      </div>

      {error && <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)', marginBottom: 12 }}>{error}</div>}
      {!data && !error && <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>}
      {data && data.solicitudes.length === 0 && (
        <div style={{
          padding: 20, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)',
          font: 'var(--text-label)', color: 'var(--ink-quiet)', textAlign: 'center',
        }}>
          Sin solicitudes de muestra{editable ? ' — usa «+ Nueva solicitud».' : '.'}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {grupos.map(vs => (
          <SolicitudGrupo key={vs[0].grupoId} versiones={vs} readOnly={!editable} onChanged={cargar} />
        ))}
      </div>

      {nueva && <MuestraModal padre={padre} itemId={itemId} onClose={() => setNueva(false)} onSaved={cargar} />}
    </div>
  );
}
