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
