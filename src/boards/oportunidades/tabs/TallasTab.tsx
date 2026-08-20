// Tallas (Oportunidad): link al Google Sheet del proyecto (recorte a petición
// de Efraín, 2026-07-17 — el resto del flujo de cmp-tallas vive en
// ProyectoTallasSection) + captura de tallas por boxes, que desde 2026-08-20
// vive en ../proyecto/TallaCapture.tsx porque el Proyecto la muestra también
// (en la Zona Efrain se captura desde ahí, ver TallasSection.tsx).
import type { ColMeta, ItemDTO } from '../../../lib/api';
import { TallaBoxesCapture } from '../proyecto/TallaCapture';
import { linkUrl, P_SHEET_LINK, type ProyectoState } from '../ProyectoSection';

export function TallasTab({ products, proyecto }: { subCols: ColMeta[]; products: ItemDTO[]; proyecto?: ProyectoState }) {
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
      {proyecto?.proyecto && (
        <TallaBoxesCapture proyectoId={proyecto.proyecto.id} products={products} onSaved={proyecto.reload} />
      )}
    </div>
  );
}
