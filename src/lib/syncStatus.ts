// Board-list header: "actualizado hace X min", sourced from Monday's own item.updated_at
// (not our mirror's synced_at) — the mirror's sync time lives inside the opportunity drawer.
export function lastMondayUpdateFromItems(items: { mondayUpdatedAt: string | null; pendingWrite?: boolean }[]): { updatedAt: string | null; pending: number } {
  const withDate = items.filter((i): i is typeof i & { mondayUpdatedAt: string } => !!i.mondayUpdatedAt);
  const pending = items.filter((i) => i.pendingWrite).length;
  if (withDate.length === 0) return { updatedAt: null, pending };
  const max = withDate.reduce((m, i) => (i.mondayUpdatedAt > m ? i.mondayUpdatedAt : m), withDate[0].mondayUpdatedAt);
  return { updatedAt: max, pending };
}
