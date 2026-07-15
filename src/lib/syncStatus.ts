// Derives the "sincronizado hace X min" + pending-write summary for a list of items.
export function syncStatusFromItems(items: { syncedAt: string; pendingWrite?: boolean }[]): { syncedAt: string | null; pending: number } {
  if (items.length === 0) return { syncedAt: null, pending: 0 };
  const max = items.reduce((m, i) => (i.syncedAt > m ? i.syncedAt : m), items[0].syncedAt);
  const pending = items.filter((i) => i.pendingWrite).length;
  return { syncedAt: max, pending };
}
