import type { ChangeEvent } from 'react';

export interface DocEntry {
  nombre: string;
  tipo: string;
  fecha: string;
}

interface DocUploadListProps {
  label: string;
  docs: DocEntry[];
  onUpload: (file: File) => void;
  emptyLabel: string;
  accept?: string;
}

const FileIcon = ({ size = 14, color = '#a49d8e' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

/** Dashed drop zone + a flat list of uploaded documents — repeats across every doc-collection point in the Oportunidades drawer. */
export function DocUploadList({ label, docs, onUpload, emptyLabel, accept }: DocUploadListProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = '';
  };

  return (
    <div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 10, border: '1px dashed #cfc8b8', borderRadius: 8,
        padding: '10px 12px', cursor: 'pointer', background: '#faf8f3', marginBottom: 10,
      }}>
        <FileIcon size={16} color="#918b7c" />
        <span style={{ font: '500 12.5px \'Inter\', sans-serif', color: '#726d61' }}>{label}</span>
        <input type="file" accept={accept} onChange={handleChange} style={{ display: 'none' }} />
      </label>

      {docs.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
          {docs.map((d, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderTop: i === 0 ? 'none' : '1px solid #ece6d9', background: '#fff',
            }}>
              <FileIcon />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ font: '600 12px \'Inter\', sans-serif', color: 'var(--ink)' }}>{d.nombre}</div>
                <div style={{ font: '400 11px \'Inter\', sans-serif', color: 'var(--ink-quiet)', marginTop: 1 }}>{d.tipo} · {d.fecha}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>{emptyLabel}</div>
      )}
    </div>
  );
}
