// Formatting helpers shared by cell renderers and sync indicators.

const MONEY_KEYWORDS = ['precio', 'costo', 'total', 'subtotal', 'utilidad', 'techo', 'iva'];

/** Does this column title look like a currency field? (Precio, Costo, Total, Subtotal, Utilidad, Techo, IVA) */
export function isMoneyTitle(title: string): boolean {
  const t = title.toLowerCase();
  return MONEY_KEYWORDS.some((k) => t.includes(k));
}

export function fmtMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-MX');
}

/** Semáforo de la Utilidad %: rojo si se pierde dinero, ámbar abajo del 20%,
 * verde arriba. La misma escala en la grid de Cotización y en la lista, para
 * que un renglón no cambie de color al abrirlo. */
export function marginColor(pct: number): string {
  if (pct < 0) return '#ce3048';
  if (pct < 20) return '#e99729';
  return '#00b461';
}

/** Dinero abreviado para las métricas de la lista: $500K, $1.3M, $718.
 * Efraín (2026-08-20) las quiere así "para facilitar la lectura" — un renglón
 * con seis cifras completas ($1,302,519) se vuelve ilegible de un vistazo.
 * Solo para LEER de reojo: la cotización y los PDFs siguen con fmtMoney, que
 * no redondea nada. */
export function fmtMoneyShort(n: number): string {
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  // Una cifra decimal, y sin el ".0" cuando es redonda: $1.3M pero $2M.
  const corta = (v: number, sufijo: string) =>
    `${signo}$${(Math.round(v * 10) / 10).toLocaleString('es-MX')}${sufijo}`;
  if (abs >= 1_000_000) return corta(abs / 1_000_000, 'M');
  if (abs >= 1_000) return corta(abs / 1_000, 'K');
  return `${signo}$${Math.round(abs).toLocaleString('es-MX')}`;
}

/** "sincronizado hace X min" style relative time from an ISO timestamp. */
export function fmtSyncAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min <= 0) return 'hace unos segundos';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}
