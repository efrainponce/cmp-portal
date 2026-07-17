// Real file columns from Oportunidades (item-level) rendered read-only —
// upload has no backend endpoint yet, so the dropzone is disabled per the
// design system's "(próximamente)" convention rather than faked.
import type { ItemDetailDTO } from '../../../lib/api';

const SOLICITUDES_COL = 'file_mm0z6rze';       // Cotizaciones sin precio
export const NO_FIRMADAS_COL = 'file_mm0fgrzq'; // Cotizaciones generadas
export const FIRMADAS_COL = 'file_mm0zjras';    // Cotizaciones Firmadas

interface DocFile { url: string; name: string }

function parseFiles(text?: string): DocFile[] {
  if (!text) return [];
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((url) => ({
    url,
    name: decodeURIComponent(url.split('/').pop() || url),
  }));
}

/** Última URL subida a una columna de archivo (Monday las agrega en orden de subida). */
export function latestFileUrl(text?: string): string | undefined {
  const files = parseFiles(text);
  return files.length ? files[files.length - 1].url : undefined;
}

export function DocumentacionTab({ item }: { item: ItemDetailDTO }) {
  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <DocSection title="Solicitudes de costeo" files={parseFiles(item.cols[SOLICITUDES_COL]?.text)} uploadLabel="Subir solicitud de costeo" />

      <div>
        <SectionTitle>Cotizaciones</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 10 }}>
          <DocSection title={null} accentColor="var(--status-esperando)" label="No firmadas por vendedor" files={parseFiles(item.cols[NO_FIRMADAS_COL]?.text)} uploadLabel="Subir cotización" />
          <DocSection title={null} accentColor="var(--status-ganada)" label="Firmadas por vendedor" files={parseFiles(item.cols[FIRMADAS_COL]?.text)} uploadLabel="Subir cotización firmada" />
        </div>
      </div>

      <DocSection title="Órdenes de compra / contrato firmado" subtitle="Orden de compra, cotización firmada por el cliente o contrato firmado." files={[]} uploadLabel="Subir orden de compra o contrato" />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)' }}>{children}</div>;
}

function DocSection({ title, subtitle, label, accentColor, files, uploadLabel }: {
  title: string | null; subtitle?: string; label?: string; accentColor?: string; files: DocFile[]; uploadLabel: string;
}) {
  return (
    <div>
      {title && <SectionTitle>{title}</SectionTitle>}
      {subtitle && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2, marginBottom: 4 }}>{subtitle}</div>}
      {label && (
        <div style={{ font: '600 10.5px \'Inter\', sans-serif', color: accentColor, textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 8 }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, border: '1px dashed var(--ink-faint)', borderRadius: 'var(--radius-lg)',
        padding: '10px 12px', marginTop: title || label ? 6 : 0, marginBottom: 10, background: 'var(--bg)', opacity: .6,
      }}>
        <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{uploadLabel} (próximamente)</span>
      </div>
      {files.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
          {files.map((f, i) => (
            <a
              key={i}
              href={f.url}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', background: '#fff', textDecoration: 'none' }}
            >
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
            </a>
          ))}
        </div>
      ) : (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>Sin documentos.</div>
      )}
    </div>
  );
}
