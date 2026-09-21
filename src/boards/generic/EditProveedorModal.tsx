// Edición de un proveedor (2026-09-21, salida de Monday): datos de contacto,
// fiscales y los tres archivos (Constancia, Cuenta de Banco, Actas) que hasta
// hoy solo se capturaban en Monday. Los campos salen de la metadata del board
// (`ColMeta.w`), no de una lista fija: lo que Compras puede escribir lo decide
// shared/visibility.ts. A diferencia de EditContactoModal, aquí hay botón
// Guardar — son varios campos de texto, no un picker que guarda al clic.
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { FormField } from '../../components/forms/FormField';
import {
  useBoards, colForBoard, patchItem, getProveedorArchivos, uploadProveedorArchivo,
  type ColMeta, type ItemDTO, type ProveedorArchivo,
} from '../../lib/api';
import { useSaveState } from '../../lib/useSaveState';

interface Props {
  proveedor: ItemDTO;
  onClose: () => void;
  onSaved: () => void;
}

/** Valor del form a partir de lo que trae el mirror. Teléfono viaja como
 * "CC:número" (FormField) y el mirror solo guarda los dígitos; link llega como
 * "etiqueta - url" y se edita solo la URL. */
function valorInicial(col: ColMeta, item: ItemDTO): string {
  const text = item.cols[col.id]?.text ?? '';
  if (col.type === 'phone') {
    const digitos = text.replace(/\D/g, '');
    return digitos ? `MX:${digitos}` : '';
  }
  if (col.type === 'link') return text.match(/https?:\/\/\S+/)?.[0] ?? text;
  return text;
}

export function EditProveedorModal({ proveedor, onClose, onSaved }: Props) {
  const { boards } = useBoards();
  const cols = colForBoard(boards, 'proveedores');
  const campos = cols.filter((c) => c.w && c.type !== 'file' && c.id !== 'name');
  const archivoCols = cols.filter((c) => c.type === 'file');

  const [name, setName] = useState(proveedor.name);
  const [valores, setValores] = useState<Record<string, string>>({});
  const iniciales = useRef<Record<string, string>>({});
  // `cols` llega vacío en el primer render (useBoards todavía resolviendo): los
  // valores se siembran cuando aparece cada columna, sin pisar lo ya tecleado.
  useEffect(() => {
    setValores((v) => {
      const next = { ...v };
      for (const c of campos) {
        if (c.id in iniciales.current) continue;
        iniciales.current[c.id] = valorInicial(c, proveedor);
        next[c.id] = iniciales.current[c.id];
      }
      return next;
    });
  }, [cols.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const [archivos, setArchivos] = useState<Record<string, ProveedorArchivo[]>>({});
  const cargarArchivos = () => getProveedorArchivos(proveedor.id).then(setArchivos).catch(() => {});
  useEffect(() => { cargarArchivos(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { saving, error, run } = useSaveState<string>();

  const cambios = (): Record<string, string> => {
    const out: Record<string, string> = {};
    if (name.trim() && name.trim() !== proveedor.name) out.name = name.trim();
    for (const c of campos) {
      const v = valores[c.id] ?? '';
      if (v !== iniciales.current[c.id]) out[c.id] = v;
    }
    return out;
  };
  const hayCambios = Object.keys(cambios()).length > 0;

  const guardar = () => run(async () => {
    if (!name.trim()) throw new Error('El nombre es obligatorio.');
    const res = await patchItem('proveedores', proveedor.id, cambios());
    if (!res.ok) throw new Error(res.error ?? 'No se pudo guardar.');
    onSaved();
    onClose();
  }, 'datos');

  const subir = (colId: string, file: File) => run(async () => {
    await uploadProveedorArchivo(proveedor.id, colId, file);
    await cargarArchivos();
    onSaved();
  }, colId);

  const label = { font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', marginBottom: 6 } as const;

  return (
    <Modal
      title={proveedor.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button variant="primary" onClick={saving || !hayCambios ? undefined : guardar}>
            {saving === 'datos' ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={label}>Nombre *</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box' }}
          />
        </div>

        {campos.map((c) => (
          <div key={c.id}>
            <div style={label}>{c.title}</div>
            <FormField col={c} value={valores[c.id] ?? ''} onChange={(v) => setValores((prev) => ({ ...prev, [c.id]: v }))} />
          </div>
        ))}

        {archivoCols.map((c) => (
          <div key={c.id}>
            <div style={label}>{c.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(archivos[c.id] ?? []).length === 0 && (
                <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin archivos.</div>
              )}
              {(archivos[c.id] ?? []).map((a) => (
                <a key={a.assetId} href={a.url} target="_blank" rel="noreferrer"
                  style={{ font: 'var(--text-body)', color: 'var(--accent)', overflowWrap: 'anywhere' }}>
                  {a.name}
                </a>
              ))}
              {c.w && (
                <label style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', cursor: saving ? 'default' : 'pointer', alignSelf: 'flex-start' }}>
                  {saving === c.id ? 'Subiendo…' : '+ Subir archivo'}
                  <input
                    type="file"
                    disabled={!!saving}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) subir(c.id, file);
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        ))}

        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}
