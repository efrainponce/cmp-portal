// Tallas: por ahora solo el link al Google Sheet del proyecto — el resto del
// flujo (regenerar/validar/importar, grid de tallas importadas) se recorta
// temporalmente a petición de Efraín (2026-07-17).
import type { ColMeta, ItemDTO } from '../../../lib/api';
import { linkUrl, P_SHEET_LINK, type ProyectoState } from '../ProyectoSection';

export function TallasTab({ proyecto }: { subCols: ColMeta[]; products: ItemDTO[]; proyecto?: ProyectoState }) {
  if (proyecto?.loading) {
    return (
      <div style={{ padding: '24px 32px 40px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Buscando el proyecto ligado…
      </div>
    );
  }

  const sheetUrl = proyecto?.proyecto ? linkUrl(proyecto.proyecto, P_SHEET_LINK) : '';

  return (
    <div style={{ padding: '24px 32px 40px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
      {sheetUrl ? (
        <a href={sheetUrl} target="_blank" rel="noreferrer" style={{ font: 'var(--text-body-strong)', color: 'var(--accent)', textDecoration: 'none' }}>
          Abrir archivo de tallas ↗
        </a>
      ) : (
        'Esta oportunidad aún no tiene archivo de tallas.'
      )}
    </div>
  );
}
