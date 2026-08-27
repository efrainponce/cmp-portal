// Costeo del Proyecto — la grid COMPLETA de Validación de Costeo, de solo
// lectura y con la fila de TOTAL abajo (Efraín, 2026-08-27: "jalar TODA la info
// de costeo, todas las columnas que tiene Validación Costeo, solo lectura, con
// totales hasta abajo"). Solo admins y solo en el Reporte de Proyectos
// (ProyectoDrawer decide quién ve el tab).
//
// Reusa CotizacionTab tal cual (`variant="costeo"` + `soloLectura`) en vez de
// dibujar otra grid: son las mismas ~16 columnas, los mismos anchos y la misma
// TotalsRow que Costeo/Validación: una copia se desalinearía sola la próxima
// vez que se agregue una columna. Lo que NO reusa es CotizacionVirtualTab, el
// otro tab del proyecto: ese es la vista corta (producto/cantidad/precio) y sí
// escribe a Monday con "Editar/Dividir".
//
// El dinero no vive en el board Proyectos: vive en las líneas de la Oportunidad
// ligada, así que esto la lee por su id (`getProyectoOportunidad` ya lo resolvió
// en el drawer). Se lee DOS veces, como el drawer de la Oportunidad: primero el
// mirror de D1, que pinta la grid de inmediato, y encima una relectura `fresh`
// contra Monday (medida en local: ~4 s) que corrige lo que el mirror traiga
// atrasado. Con solo `fresh` la pestaña se quedaba esos 4 s en "Cargando"; con
// solo el mirror se puede estar viendo un costo viejo, y aquí el número es todo
// el punto (parity con Monday al abrir).
import { useEffect, useState } from 'react';
import { colForBoard, useBoards, type ItemDetailDTO } from '../../lib/api';
import { getItemDetail } from '../../lib/apiClient';
import { CotizacionTab } from '../oportunidades/tabs/CotizacionTab';

export function CosteoProyectoTab({ oportunidadId }: { oportunidadId: string }) {
  const { boards } = useBoards();
  const subCols = colForBoard(boards, 'oportunidades_sub');
  const [item, setItem] = useState<ItemDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setItem(null);
    setError(null);
    getItemDetail('oportunidades', oportunidadId)
      .then(({ item: it }) => { if (!cancelado) setItem(it); })
      .catch(() => { if (!cancelado) setError('No se pudo cargar el costeo de la Oportunidad ligada.'); })
      // La relectura viva va DESPUÉS y nunca borra lo ya pintado: si Monday
      // falla o tarda, se queda lo del mirror en vez de un error en rojo.
      .then(() => getItemDetail('oportunidades', oportunidadId, { fresh: true }))
      .then((r) => { if (r && !cancelado) setItem(r.item); })
      .catch(() => { /* el mirror ya está en pantalla */ });
    return () => { cancelado = true; };
  }, [oportunidadId]);

  if (error) return <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--status-perdida)' }}>{error}</div>;
  if (!item) return <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando costeo…</div>;

  return (
    <div>
      <div style={{ padding: '20px 32px 0', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
        Costeo de la Oportunidad ligada, tal cual se ve en Validación de Costeo.
        Solo lectura: para cambiar un costo o un precio se hace en su board.
      </div>
      <CotizacionTab
        subCols={subCols}
        products={item.children ?? []}
        variant="costeo"
        oppId={oportunidadId}
        editable={false}
        soloLectura
      />
    </div>
  );
}
