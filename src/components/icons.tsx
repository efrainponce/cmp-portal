import type { CSSProperties } from 'react';

interface IconProps {
  style?: CSSProperties;
}

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconOportunidades = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" />
  </svg>
);

export const IconGlobe = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="10" /><path d="M2 12h20" />
    <path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" />
  </svg>
);

export const IconCosteo = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
  </svg>
);

export const IconValidacion = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
  </svg>
);

export const IconDocTallas = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15h6M9 11h2" />
  </svg>
);

export const IconOrdenesCompra = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="21" r="1" /><circle cx="19" cy="21" r="1" />
    <path d="M1 1h4l2.6 13.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6L23 6H6" />
  </svg>
);

export const IconLogistica = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="1" y="7" width="14" height="11" rx="1" /><path d="M15 10h4l3 3v5h-7z" />
    <circle cx="6" cy="20" r="1.6" /><circle cx="17.5" cy="20" r="1.6" />
  </svg>
);

export const IconProductos = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />
  </svg>
);

export const IconCuentas = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 22V9l8-6 8 6v13" /><path d="M9 22v-7h6v7" />
  </svg>
);

export const IconClientes = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <circle cx="17.5" cy="9" r="2.4" /><path d="M15.8 14.3c2.6.4 4.7 2.4 4.7 5.7" />
  </svg>
);

export const IconInventario = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const IconChevronRight = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const IconSearch = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-quiet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
  </svg>
);

export const IconBack = (p: IconProps) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const IconUpload = (p: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#918b7c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
  </svg>
);

export const IconChat = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const IconSend = (p: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" />
  </svg>
);

export const IconEdit = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const IconLink = (p: IconProps) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
