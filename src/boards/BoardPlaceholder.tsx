interface Props {
  title: string;
}

export function BoardPlaceholder({ title }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
      <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>{title}</div>
      <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>(próximamente)</div>
    </div>
  );
}
