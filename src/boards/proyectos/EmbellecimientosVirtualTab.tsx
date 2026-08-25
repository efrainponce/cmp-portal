// Embellecimientos del Proyecto (Efraín, 2026-08-12): mismo criterio que
// CotizacionVirtualTab — se leen las líneas vigentes de la Oportunidad ligada
// (con los ajustes virtuales del Proyecto ya aplicados, mismo endpoint
// GET .../cotizacion-virtual) y se muestran igual que en Oportunidades
// (zonas + imagen de referencia por zona). El TEXTO de las zonas y sus
// imágenes siguen siendo solo lectura aquí: capturarlos es de la Oportunidad.
// Incluye precio unitario y subtotal por línea — Oportunidades no lo muestra
// en esta tab, pero aquí sí se pidió (Efraín, 2026-08-12).
//
// PROVEEDOR POR LÍNEA DE EMBELLECIMIENTO (Efraín, 2026-08-25: "no se puede
// seleccionar el proveedor de embellecimiento, es súper importante"): quien
// borda/estampa casi nunca es el proveedor de la prenda, y hasta hoy solo se
// le podía asignar desde el ⇄ de Órdenes de compra — donde las líneas ✨ se
// ven fuera de contexto, sin la posición ni la imagen de referencia. Aquí cada
// posición muestra su proveedor y lo deja cambiar (Compras/Admin), escribiendo
// el MISMO board_relation que agrupa las OC, así que la línea entra sola en la
// OC de ese bordador.
//
// Si la posición todavía no tiene línea en el Proyecto (proyectos de captura
// nativa, o embellecimientos que se agregaron después de importar tallas),
// "Asignar proveedor" la CREA — "✨ <zona>" con la descripción y la cantidad
// de la línea, idéntica a las que crea Importar tallas — porque sin línea no
// hay nada que mandarle al bordador. El costo se captura en Órdenes de compra,
// como el de cualquier otra línea.
import { useEffect, useState } from 'react';
import type { ItemDetailDTO, QuoteLineSnapshot } from '../../lib/api';
import { getCotizacionVirtual, getZoneImages, addProyectoLinea, patchItem } from '../../lib/apiClient';
import { useMe } from '../../lib/useMe';
import { fmtMoney } from '../../lib/format';
import { StatusBadge, MonoTag, AjusteLabelBadge } from '../../components/core/Badges';
import { explodeEmbellecimiento } from '../../lib/embellecimiento';
import { ZoneImage } from '../oportunidades/tabs/EmbellecimientosTab';
import { S_PRODUCTO, S_CANTIDAD, S_PROVEEDOR, S_PROVEEDOR_RAZON } from '../oportunidades/proyecto/shared';
import { SeleccionarProveedorModal } from './SeleccionarProveedorModal';
import {
  emparejarEmbell, claveZona, esLineaEmbellecimiento, zonaDeNombre,
  type EmbLinea,
} from './embellLineas';

/** Línea ✨ del Proyecto con lo que la tab necesita pintar. */
interface LineaEmb extends EmbLinea {
  proveedor: string;
  cantidad: string;
}

/** Qué se va a asignar: una línea ✨ que ya existe, o una zona que todavía no
 * tiene línea (y hay que crearla). */
type Destino =
  | { tipo: 'linea'; linea: LineaEmb }
  | { tipo: 'crear'; zona: string; descripcion: string; cantidad: number };

export function EmbellecimientosVirtualTab({ proyectoId, proyecto, onChanged }: {
  proyectoId: string;
  /** Proyecto ya cargado por el drawer — de aquí salen las líneas ✨. */
  proyecto?: ItemDetailDTO | null;
  /** Recarga el proyecto tras asignar/crear (el drawer es el dueño del dato). */
  onChanged?: () => void;
}) {
  const me = useMe();
  const [lines, setLines] = useState<QuoteLineSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoneImages, setZoneImages] = useState<Record<string, string>>({});
  const [destino, setDestino] = useState<Destino | null>(null);

  useEffect(() => {
    setError(null);
    setLines(null);
    getCotizacionVirtual(proyectoId)
      .then((data) => setLines(data.lines))
      .catch(() => setError('No se pudo cargar los embellecimientos.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId]);

  const embProducts = (lines ?? []).filter((l) => l.embellecimiento);
  // Líneas virtuales (nacidas de un "dividir" en el Proyecto, id negativo) no
  // tienen subitem real en Monday — no hay imágenes que buscar para ellas.
  const realIds = embProducts.map((l) => l.subitemId).filter((id): id is number => id != null && id > 0);
  const realIdsKey = realIds.join(',');

  useEffect(() => {
    let cancelled = false;
    for (const id of realIdsKey ? realIdsKey.split(',') : []) {
      getZoneImages(id).then((imgs) => {
        if (cancelled) return;
        setZoneImages((cur) => {
          const next = { ...cur };
          for (const [zone, url] of Object.entries(imgs)) next[`${id}:${zone}`] = url;
          return next;
        });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [realIdsKey]);

  // Precio de Venta: solo vendedor/compras/admin lo ven (shared/visibility.ts,
  // grupo V) — mismo criterio que CotizacionVirtualTab.
  const showPrice = me?.role === 'vendedor' || me?.role === 'compras' || me?.role === 'admin';
  // Proveedor: columna del grupo AC (shared/visibility.ts) — el resto de roles
  // ni siquiera la recibe, así que el selector no se les pinta. El server
  // revalida el rol en el PATCH y en el alta de la línea.
  const canProveedor = me?.role === 'compras' || me?.role === 'admin';

  const lineasEmb: LineaEmb[] = (proyecto?.children ?? [])
    .filter((l) => esLineaEmbellecimiento(l.name))
    .map((l) => ({
      id: l.id,
      zona: zonaDeNombre(l.name),
      descripcion: l.cols[S_PRODUCTO]?.text ?? '',
      proveedor: l.cols[S_PROVEEDOR_RAZON]?.text || l.cols[S_PROVEEDOR]?.text || '',
      cantidad: l.cols[S_CANTIDAD]?.text ?? '',
    }));

  const zonasDeCotizacion = embProducts.flatMap((p) => explodeEmbellecimiento(p.descripcionEmbellecimiento, true));
  const { porZona, sobrantes } = emparejarEmbell(zonasDeCotizacion, lineasEmb);
  const lineaPorId = new Map(lineasEmb.map((l) => [l.id, l]));

  const asignar = async (proveedorId: string) => {
    if (!destino) return;
    if (destino.tipo === 'linea') {
      try {
        await patchItem('proyectos_sub', destino.linea.id, { [S_PROVEEDOR]: proveedorId });
      } catch {
        throw new Error('No se pudo cambiar el proveedor de la línea.');
      }
    } else {
      // Sin proveedor no tiene caso crear la línea: quedaría suelta en "Sin
      // proveedor asignado" y es justo lo que se viene a resolver aquí.
      if (!proveedorId) throw new Error('Elige un proveedor para crear la línea.');
      const res = await addProyectoLinea(proyectoId, {
        producto: destino.descripcion || destino.zona,
        zona: destino.zona,
        cantidad: destino.cantidad || undefined,
        proveedorId,
      });
      if (!res.ok) throw new Error(res.error ?? 'No se pudo crear la línea de embellecimiento.');
    }
    onChanged?.();
  };

  if (error) return <div style={{ padding: 24, color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>;
  if (lines === null) return <div style={{ padding: 24, color: 'var(--ink-quiet)', font: 'var(--text-label)' }}>Cargando…</div>;

  if (embProducts.length === 0 && lineasEmb.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
          {lines.length === 0
            ? 'Sin líneas de cotización.'
            : 'Ninguna línea está marcada "Con Embellecimiento".'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 6 }}>
        Embellecimiento de la Oportunidad ligada. El texto de las posiciones y las imágenes de referencia se capturan
        allá{canProveedor ? '; el proveedor de cada posición se asigna aquí y es el que arma su OC' : ''}.
      </div>
      {embProducts.map((p, i) => {
        const zones = explodeEmbellecimiento(p.descripcionEmbellecimiento, true);
        const subtotal = (p.precioUnitario ?? 0) * p.cantidad;
        return (
          <div key={p.subitemId ?? i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{p.producto}</div>
              {p.sku && <MonoTag>{p.sku}</MonoTag>}
              {p.color && <span style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{p.color}</span>}
              <StatusBadge label="Con Embellecimiento" color="#00b461" tint="#d6f5e6" />
              {p.ajusteLabel && <AjusteLabelBadge label={p.ajusteLabel} />}
            </div>
            {zones.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {zones.map((z) => {
                  const key = `${p.subitemId}:${z.label}`;
                  const ligada = porZona.get(claveZona(z));
                  // El proveedor se relee de `lineaPorId`: emparejarEmbell corre
                  // sobre la lista ya cargada, y tras asignar el drawer recarga.
                  const linea = ligada ? lineaPorId.get(ligada.id) : undefined;
                  return (
                    <div key={z.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <div style={{ font: 'var(--text-body)', color: 'var(--ink-secondary)' }}>
                          <span style={{ color: 'var(--ink)' }}>{z.label}:</span> {z.value}
                        </div>
                        <ProveedorDeZona
                          linea={linea}
                          canProveedor={canProveedor}
                          onAsignar={() => setDestino(linea
                            ? { tipo: 'linea', linea }
                            : { tipo: 'crear', zona: z.label, descripcion: z.value, cantidad: p.cantidad })}
                        />
                      </div>
                      <ZoneImage
                        imageUrl={zoneImages[key]}
                        uploading={false}
                        onUpload={() => {}}
                        canUpload={false}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ font: 'var(--text-body)', color: 'var(--ink-faint)' }}>
                — sin descripción de embellecimiento —
              </div>
            )}
            {showPrice && (
              <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
                <div>Cantidad: <span style={{ color: 'var(--ink)' }}>{p.cantidad}</span></div>
                <div>Precio: <span style={{ color: 'var(--ink)' }}>{fmtMoney(p.precioUnitario ?? 0)}</span></div>
                <div>Subtotal: <span style={{ color: 'var(--ink)' }}>{fmtMoney(subtotal)}</span></div>
              </div>
            )}
          </div>
        );
      })}

      {/* Líneas ✨ que ninguna posición de la cotización reclamó (zonas fuera de
          plantilla como "✨ Etiqueta nombre", o textos que ya cambiaron en la
          cotización). Se listan igual: son líneas reales de la OC y también
          necesitan proveedor. */}
      {sobrantes.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', marginBottom: 2 }}>
            Otras líneas de embellecimiento del proyecto
          </div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 8 }}>
            Están en el proyecto (y en la OC) pero no coinciden con ninguna posición de la cotización vigente.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sobrantes.map((s) => {
              const linea = lineaPorId.get(s.id)!;
              return (
                <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ font: 'var(--text-body)', color: 'var(--ink-secondary)' }}>
                    <span style={{ color: 'var(--ink)' }}>{linea.zona}:</span> {linea.descripcion || '—'}
                    {linea.cantidad ? <span style={{ color: 'var(--ink-tertiary)' }}> · {linea.cantidad} pzas</span> : null}
                  </div>
                  <ProveedorDeZona
                    linea={linea}
                    canProveedor={canProveedor}
                    onAsignar={() => setDestino({ tipo: 'linea', linea })}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {destino && (
        <SeleccionarProveedorModal
          titulo={destino.tipo === 'linea' ? 'Proveedor de embellecimiento' : 'Asignar proveedor de embellecimiento'}
          ayuda={destino.tipo === 'linea'
            ? 'La línea de embellecimiento pasa a la OC de este proveedor.'
            : 'Esta posición todavía no tiene línea en el proyecto: se crea "✨ ' + destino.zona + '" con su descripción y cantidad, y entra en la OC de este proveedor. El costo se captura en Órdenes de compra.'}
          etiquetaQuitar={destino.tipo === 'linea' ? 'Quitarle el proveedor (la saca de toda OC)' : undefined}
          onPick={asignar}
          onClose={() => setDestino(null)}
        />
      )}
    </div>
  );
}

/** Renglón de proveedor bajo una posición: quién la borda hoy y el acceso a
 * cambiarlo. Sin permiso (vendedor) solo informa, y si ni siquiera hay línea no
 * pinta nada — el vendedor no recibe la columna Proveedor. */
function ProveedorDeZona({ linea, canProveedor, onAsignar }: {
  linea?: LineaEmb; canProveedor: boolean; onAsignar: () => void;
}) {
  if (!canProveedor) {
    if (!linea?.proveedor) return null;
    return (
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
        Proveedor: {linea.proveedor}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ font: 'var(--text-caption)', color: linea?.proveedor ? 'var(--ink-tertiary)' : 'var(--ink-quiet)' }}>
        {linea?.proveedor
          ? `Proveedor: ${linea.proveedor}`
          : linea
            ? 'Sin proveedor asignado'
            : 'Sin línea en el proyecto'}
      </span>
      <span
        onClick={onAsignar}
        title={linea
          ? 'Elegir quién borda o estampa esta posición — la línea se va a su OC'
          : 'Crear la línea de embellecimiento en el proyecto y mandarla a la OC de un proveedor'}
        style={{ font: 'var(--text-caption)', color: 'var(--accent)', cursor: 'pointer' }}
      >
        {linea?.proveedor ? 'Cambiar' : 'Asignar proveedor'}
      </span>
    </div>
  );
}
