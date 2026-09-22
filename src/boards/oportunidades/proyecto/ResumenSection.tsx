// Tab "Resumen" del Proyecto (Efraín, 2026-09-21: "eso del resumen es también
// una TAB de un proyecto"): la misma hoja que el PDF de estatus, en pantalla —
// UN renglón por producto+color (tallas sumadas) con proveedor, cantidad,
// estatus y fecha estimada, pintado por avance. Todo sale de shared/
// estatusProyecto.ts, la MISMA lógica que usa el PDF: lo que se ve es lo que se
// imprime. Solo lectura; la captura sigue en Ejecución.
import { useEffect, useState } from 'react';
import { getProductoResumen, listOcImagenes, ocImagenUrl, type ItemDTO, type OcImagenDTO } from '../../../lib/api';
import { llaveFotoOc } from '../../../../shared/ocFotoLlave';
import { Button } from '../../../components/core/Button';
import { FilePreviewModal } from '../../../components/core/FilePreviewModal';
import { ProgressBattery } from '../../../components/board/ProgressBattery';
import { batteryFromSubitems } from '../../../lib/estadoProductoBuckets';
import { agruparPorProductoColor, fechaCorta, TONO_FILL, type EstatusLinea } from '../../../../shared/estatusProyecto';
import {
  type ProyectoState, Shell,
  S_PRODUCTO, S_SKU, S_COLOR, S_CANTIDAD, S_PROVEEDOR, S_PROVEEDOR_RAZON, S_ESTADO, S_ENTREGA_PROV,
} from './shared';

// Columnas del Proyecto que van en el encabezado (mismos ids que
// worker/lib/estatusProyectoPdf.ts — docs/monday-column-map.md).
const P_FOLIO = 'pulse_id_mm1a12gy';
const P_INSTITUCION = 'lookup_mm1dwn6';
const P_VENDEDOR = 'multiple_person_mm0hrnqq';
const P_ZONA = 'dropdown_mm0hnyv';
const P_ESTADO = 'project_status';
const P_FECHA_ENTREGA = 'date_mm0m1vfv';
const P_DOCUMENTACION = 'color_mm52csps';
const S_UNIDAD = 'text_mm56dbkm';
const S_COMENTARIO = 'text_mm20gzsb';

const txt = (cols: ItemDTO['cols'], id: string) => (cols[id]?.text ?? '').trim();

function lineaDe(l: ItemDTO): EstatusLinea {
  return {
    producto: txt(l.cols, S_PRODUCTO) || l.name || '—',
    sku: txt(l.cols, S_SKU),
    color: txt(l.cols, S_COLOR),
    cantidad: Number(txt(l.cols, S_CANTIDAD).replace(/,/g, '')) || 0,
    unidad: txt(l.cols, S_UNIDAD),
    proveedor: txt(l.cols, S_PROVEEDOR) || txt(l.cols, S_PROVEEDOR_RAZON),
    estado: txt(l.cols, S_ESTADO),
    comentario: txt(l.cols, S_COMENTARIO),
    entrega: txt(l.cols, S_ENTREGA_PROV),
  };
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', font: '600 10.5px var(--font-ui)',
  color: '#fff', background: '#e8791d', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '8px 10px', font: 'var(--text-label)', color: 'var(--ink)', verticalAlign: 'top', borderBottom: '1px solid var(--border)' };

export function ResumenSection({ state }: { state: ProyectoState }) {
  const [resumenes, setResumenes] = useState<Record<string, string>>({});
  const [verPdf, setVerPdf] = useState(false);
  // Miniatura del producto (Efraín, 2026-09-21: "un thumbnail chico"): la misma
  // foto por SKU de la OC con imágenes, servida por /api/oc-imagenes y encogida
  // en pantalla — no se guarda una variante chica. `sync` jala del catálogo lo
  // que nunca se ha buscado, igual que en Órdenes de compra.
  const [fotos, setFotos] = useState<Record<string, OcImagenDTO>>({});
  const proyectoId = state.proyecto?.id;
  const llaves = [...new Set((state.proyecto?.children ?? []).map((l) => llaveFotoOc(txt(l.cols, S_SKU), txt(l.cols, S_PRODUCTO))).filter(Boolean))].join('\n');

  useEffect(() => {
    let vivo = true;
    const lista = llaves.split('\n').filter(Boolean);
    if (lista.length === 0) { setFotos({}); return; }
    listOcImagenes(lista, true)
      .then((rows) => { if (vivo) setFotos(Object.fromEntries(rows.map((r) => [r.sku.toUpperCase(), r]))); })
      .catch(() => { /* sin miniaturas, la tabla sale igual */ });
    return () => { vivo = false; };
  }, [llaves]);

  useEffect(() => {
    if (!proyectoId) return;
    getProductoResumen(proyectoId).then((rows) => {
      const map: Record<string, string> = {};
      for (const r of rows) map[`${r.producto}|${r.color}`] = r.resumen;
      setResumenes(map);
    }).catch(() => setResumenes({}));
  }, [proyectoId]);

  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — el resumen arranca cuando se generan las órdenes de compra a proveedor." />;
  }
  const p = state.proyecto;
  const lineas = (p.children ?? []).map(lineaDe);
  const grupos = agruparPorProductoColor(lineas, resumenes);
  const conProveedor = grupos.some((g) => g.proveedor);
  const total = grupos.reduce((s, g) => s + g.cantidad, 0);
  const entregadas = grupos.reduce((s, g) => s + g.entregadas, 0);
  const battery = batteryFromSubitems((p.children ?? []).map((l) => ({
    estado: l.cols[S_ESTADO]?.text,
    cantidad: Number((l.cols[S_CANTIDAD]?.text || '0').replace(/,/g, '')) || 0,
  })));
  const fechaEntrega = txt(p.cols, P_FECHA_ENTREGA);

  const datos: [string, string][] = [
    ['Folio', txt(p.cols, P_FOLIO) || '—'],
    ['Institución', txt(p.cols, P_INSTITUCION) || '—'],
    ['Vendedor', txt(p.cols, P_VENDEDOR) || '—'],
    ['Zona', txt(p.cols, P_ZONA) || '—'],
    ['Estado del proyecto', txt(p.cols, P_ESTADO) || '—'],
    ['Fecha de entrega', fechaEntrega ? fechaCorta(fechaEntrega) : 'Sin fecha'],
    ['Documentación', txt(p.cols, P_DOCUMENTACION) || 'Sin cargar'],
    ['Avance', total > 0 ? `${entregadas} de ${total} piezas entregadas (${Math.round((entregadas / total) * 100)}%)` : '—'],
  ];

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px 24px', flex: 1 }}>
          {datos.map(([k, v]) => (
            <div key={k}>
              <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.3px' }}>{k}</div>
              <div style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>{v}</div>
            </div>
          ))}
        </div>
        {grupos.length > 0 && (
          <Button variant="secondary" style={{ padding: '6px 14px', font: 'var(--text-label)' }} onClick={() => setVerPdf(true)} title="La misma hoja, imprimible: con foto del producto">
            Estatus en PDF
          </Button>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <ProgressBattery data={battery} size="full" />
      </div>

      {grupos.length === 0 ? (
        <Shell hint="Este proyecto todavía no tiene productos (faltan las tallas)." />
      ) : (
        <div style={{ marginTop: 16, overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={th}>#</th>
                <th style={{ ...th, width: 40 }} aria-label="Foto" />
                <th style={th}>Producto y color</th>
                {conProveedor && <th style={th}>Proveedor</th>}
                <th style={{ ...th, textAlign: 'right' }}>Cant.</th>
                <th style={th}>Unidad</th>
                <th style={th}>Estatus</th>
                <th style={th}>Entrega</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g, i) => (
                <tr key={`${g.producto}|${g.color}`} style={{ background: TONO_FILL[g.tono] ?? (i % 2 ? 'var(--bg-sunken, #f6f8fa)' : 'transparent') }}>
                  <td style={td}>{i + 1}</td>
                  <td style={{ ...td, padding: '4px 6px' }}><Miniatura llave={llaveFotoOc(g.sku, g.producto === '—' ? '' : g.producto)} fotos={fotos} /></td>
                  <td style={td}>{g.producto}{g.sku ? ` (${g.sku})` : ''}{g.color ? ` · ${g.color}` : ''}</td>
                  {conProveedor && <td style={td}>{g.proveedor || '—'}</td>}
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{g.cantidad.toLocaleString('es-MX')}</td>
                  <td style={td}>{g.unidad || '—'}</td>
                  <td style={td}>{g.estatus}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{g.entrega}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 8, font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
        Un renglón por producto y color (las tallas van sumadas). Verde = entregado al cliente · Azul = en proceso · Rojo = incidencia o retraso · Sin color = pendiente de surtir. Para cambiar un estado usa la pestaña Ejecución.
      </div>
      {verPdf && (
        <FilePreviewModal url={`/api/proyectos/${p.id}/estatus/pdf`} name={`${p.name} - Estatus.pdf`} onClose={() => setVerPdf(false)} />
      )}
    </div>
  );
}

/** 36×36 con la foto del catálogo; sin foto, un recuadro gris discreto. */
function Miniatura({ llave, fotos }: { llave: string; fotos: Record<string, OcImagenDTO> }) {
  const meta = fotos[llave.toUpperCase()];
  const box: React.CSSProperties = { width: 36, height: 36, borderRadius: 6, border: '1px solid var(--border)', background: '#fff', display: 'block', objectFit: 'contain' };
  if (!meta || meta.estado !== 'ok') return <div style={{ ...box, background: 'var(--bg-sunken, #efefef)' }} title="Sin foto en el catálogo" />;
  return <img src={ocImagenUrl(llave, meta.updatedAt)} alt="" loading="lazy" style={box} />;
}
