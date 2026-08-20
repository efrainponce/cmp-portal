// Captura de tallas por boxes: una tarjeta por línea de cotización
// (producto+color) con una cajita por talla. Guarda directo como subitems del
// Proyecto (worker/lib/proyectoTallas.ts), sin pasar por cmp-tallas ni por el
// Google Sheet.
//
// Vivía dentro de tabs/TallasTab.tsx (solo accesible desde la Oportunidad).
// Se sacó aquí el 2026-08-20 porque en la Zona Efrain el desglose se captura
// desde el PROYECTO: el vacío de la pestaña Tallas del Proyecto mandaba a
// "captúralas en la pestaña Tallas de la Oportunidad" y nadie encontraba el
// camino (Efraín: "necesito dónde capturar las tallas, no me aparece"). Ahora
// el mismo componente se usa en los dos lugares.
import { useState } from 'react';
import type { ItemDTO } from '../../../lib/api';
import { capturarTallas, type TallaBoxInput } from '../../../lib/api';
import { Button } from '../../../components/core/Button';

// Oportunidades subitems (oportunidades_sub, 18395657607) — líneas de la
// cotización ganada, mismos ids que worker/lib/quoteVersions.ts.
const SUB_SKU = 'lookup_mkzn7x9a';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_CANTIDAD = 'numeric_mkzm6399';

const DEFAULT_TALLAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

interface ProductoGroup {
  subitemId: string;
  producto: string;
  sku?: string;
  color?: string;
  cantidad: number;
}

function groupsFromProducts(products: ItemDTO[]): ProductoGroup[] {
  return products
    .map((p): ProductoGroup => ({
      subitemId: p.id,
      producto: p.name,
      sku: p.cols[SUB_SKU]?.text || undefined,
      color: p.cols[SUB_COLOR]?.text || undefined,
      cantidad: Number((p.cols[SUB_CANTIDAD]?.text ?? '').replace(/,/g, '')) || 0,
    }))
    .filter(g => g.cantidad > 0);
}

const boxInputStyle = {
  width: 46, textAlign: 'center' as const, font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '6px 4px',
};

function ProductoTallaCard({ group, boxes, onChange, onAddTalla }: {
  group: ProductoGroup;
  boxes: Record<string, string>;
  onChange: (talla: string, value: string) => void;
  onAddTalla: (talla: string) => void;
}) {
  const [nuevaTalla, setNuevaTalla] = useState('');
  const extra = Object.keys(boxes).filter(t => !DEFAULT_TALLAS.includes(t));
  const tallas = [...DEFAULT_TALLAS, ...extra];
  const suma = Object.values(boxes).reduce((s, v) => s + (Number(v) || 0), 0);
  const cuadra = suma === group.cantidad;

  const agregarTalla = () => {
    const t = nuevaTalla.trim();
    if (!t) return;
    onAddTalla(t);
    setNuevaTalla('');
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.producto}</div>
        {group.sku && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{group.sku}</span>}
        {group.color && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>· {group.color}</span>}
        <div style={{ marginLeft: 'auto', font: 'var(--text-caption-strong)', color: cuadra ? 'var(--status-ganada)' : 'var(--status-esperando)' }}>
          {suma} / {group.cantidad}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {tallas.map(talla => (
          <label key={talla} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{talla}</span>
            <input
              type="number" min={0} inputMode="numeric"
              value={boxes[talla] ?? ''}
              onChange={(e) => onChange(talla, e.target.value)}
              style={boxInputStyle}
            />
          </label>
        ))}
        <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>&nbsp;</span>
          <input
            placeholder="+ talla" value={nuevaTalla}
            onChange={(e) => setNuevaTalla(e.target.value)}
            onBlur={agregarTalla}
            onKeyDown={(e) => { if (e.key === 'Enter') agregarTalla(); }}
            style={{ ...boxInputStyle, width: 66, textAlign: 'left', border: '1px dashed var(--border)' }}
          />
        </label>
      </div>
    </div>
  );
}

type BoxState = Record<string, Record<string, string>>; // subitemId -> talla -> cantidad texto

export function TallaBoxesCapture({ proyectoId, products, onSaved, titulo, hint }: {
  proyectoId: string; products: ItemDTO[]; onSaved: () => void;
  titulo?: string; hint?: string;
}) {
  const groups = groupsFromProducts(products);
  const [state, setState] = useState<BoxState>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (groups.length === 0) return null;

  const setBox = (subitemId: string, talla: string, value: string) =>
    setState(prev => ({ ...prev, [subitemId]: { ...prev[subitemId], [talla]: value } }));
  const addTalla = (subitemId: string, talla: string) =>
    setState(prev => ({ ...prev, [subitemId]: { ...prev[subitemId], [talla]: prev[subitemId]?.[talla] ?? '' } }));

  const guardar = async () => {
    const rows: TallaBoxInput[] = [];
    for (const g of groups) {
      for (const [talla, raw] of Object.entries(state[g.subitemId] ?? {})) {
        const cantidad = Number(raw);
        if (cantidad > 0) rows.push({ subitemId: Number(g.subitemId), producto: g.producto, sku: g.sku, color: g.color, talla, cantidad });
      }
    }
    if (rows.length === 0) { setResult({ kind: 'error', text: 'Captura al menos una talla con cantidad.' }); return; }
    setSaving(true);
    setResult(null);
    const res = await capturarTallas(proyectoId, rows);
    setSaving(false);
    if (!res.ok) { setResult({ kind: 'error', text: res.error ?? 'No se pudo guardar.' }); return; }
    setResult({
      kind: 'ok',
      text: `${res.created ?? 0} tallas guardadas`
        + (res.updated ? `, ${res.updated} actualizadas` : '')
        + (res.omitted ? `, ${res.omitted} sin cambios` : '') + '.',
    });
    setState({});
    onSaved();
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 2 }}>
        {titulo ?? 'Desglose de tallas'}
      </div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>
        {hint ?? 'Cuántas piezas de cada talla por producto — se guardan directo como líneas del proyecto.'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map(g => (
          <ProductoTallaCard
            key={g.subitemId}
            group={g}
            boxes={state[g.subitemId] ?? {}}
            onChange={(talla, value) => setBox(g.subitemId, talla, value)}
            onAddTalla={(talla) => addTalla(g.subitemId, talla)}
          />
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button variant={saving ? 'disabled' : 'primary'} onClick={saving ? undefined : guardar}>
          {saving ? 'Guardando…' : 'Guardar tallas'}
        </Button>
        {result && (
          <span style={{ font: 'var(--text-label)', color: result.kind === 'ok' ? 'var(--status-ganada)' : 'var(--status-perdida)' }}>
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
