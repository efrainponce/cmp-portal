// ── THE WHITELIST AS DATA ─────────────────────────────────────────────────────
// vis: roles that may READ a column. w: roles that may WRITE it (via outbox).
// FAIL-CLOSED: a column not listed here is invisible to every role and the
// serializer must drop it. Tags for oportunidades(+sub) follow the approved
// docs/monday-column-map.md; tags for proyectos/productos/instituciones/contactos
// are PROPOSED (2026-07-14 overnight build) — pending Efraín's review.
// 'admin' must be tagged explicitly; there is no implicit superuser in DTOs.
import type { Role } from './types';
import type { BoardSlug } from './boards';

export interface ColRule { vis: Role[]; w?: Role[] }

const V: Role[] = ['vendedor', 'compras', 'admin'];   // seller-visible
const AC: Role[] = ['compras', 'admin'];              // internal: costs, proveedor, ops
const WV: Role[] = ['vendedor', 'admin'];             // PROPOSED writable set

const vis = (ids: string[], r: Role[]): Record<string, ColRule> =>
  Object.fromEntries(ids.map(id => [id, { vis: r }]));

export const VISIBILITY: Record<BoardSlug, Record<string, ColRule>> = {
  oportunidades: {
    ...vis(['name', 'pulse_id_mm0qcq0m', 'deal_stage', 'deal_owner',
      'multiple_person_mm0wt53c', 'deal_expected_close_date', 'deal_contact',
      'lookup_mm1bs976', 'lookup_mm0xf2r5', 'dropdown_mm03g067', 'lookup_mm0pt4mj',
      'lookup_mkznd66k', 'lookup_mm00p07m', 'date_mm09mv5b', 'file_mm0fgrzq',
      'file_mm0zjras', 'color_mm47f0ca', 'dropdown_mm0mg00', 'text_mm47xmh',
      'lookup_mm087at6', 'file_mm0z6rze', 'date_mm094kzf', 'date_mm09b6nz',
      'date_mm0mc3dj'], V),
    // PROPOSED writable (per write-path discussion; flip = one-line change):
    text_mm0gje0:       { vis: V, w: WV },   // Vigencia de la cotización
    text_mm0gjrrd:      { vis: V, w: WV },   // Tiempo de entrega
    long_text_mm1m416j: { vis: V, w: WV },   // Comentarios cotización
    ...vis(['lookup_mm4g2hqf', 'lookup_mm35sk4e', 'lookup_mm0cvyfc',
      'lookup_mm1w47fq', 'multiple_person_mm03qyw9', 'multiple_person_mm1m73qp'], AC),
  },

  oportunidades_sub: {
    ...vis(['name', 'text_mm0bkm1j', 'lookup_mm0x4kda', 'lookup_mkzn7x9a',
      'text_mm0bxy39', 'lookup_mm0xn98d', 'text_mm07s2mg', 'lookup_mm19c0b6',
      'numeric_mkzm6399', 'lookup_mm0w4f4v', 'lookup_mm0xw8p7', 'color_mm1b34bg',
      'long_text_mm1bj4pt', 'long_text_mm1hyszv',
      'numeric_mkzneg3d',                       // Precio de Venta C/U — the point of phase 1
      'formula_mkznmjh6', 'formula_mm0rtdqp', 'formula_mm00xy0n',
      'color_mm084gvf'], V),
    ...vis(['lookup_mm11t8gj', 'numeric_mm0bph99', 'numeric_mkzn2q51',
      'lookup_mm0bdwb5', 'formula_mkznqx51', 'formula_mkzngnjm', 'numeric_mm0rvhgs',
      'formula_mm0rqjv1', 'numeric_mkzngs9x', 'lookup_mm0bbz02', 'long_text_mm1b9bh8',
      'numeric_mm0gxvpa', 'formula_mkznpfgg', 'formula_mkznrm5a', 'numeric_mkznpn83',
      'numeric_mm2qzzbe', 'numeric_mkznnm5s', 'formula_mkznsb7m', 'formula_mkznpp33',
      'formula_mkzne7gd', 'formula_mkznry25', 'formula_mkznpw5p', 'formula_mkzn28xk',
      'lookup_mm1tjv9n'], AC),                  // the Costeo view columns
  },

  proyectos: {
    ...vis(['name', 'pulse_id_mm1a12gy', 'project_status', 'lookup_mm20g4n6',
      'date_mm0m1vfv', 'link_mm1amwz8', 'file_mm0hwapr', 'lookup_mm1dwn6',
      'color_mm0mcrjq',                          // Estado Pago — recomendación aceptada
      'multiple_person_mm0hrnqq', 'board_relation_mm0hb0gy', 'lookup_mm1d1546',
      'dropdown_mm0hnyv', 'lookup_mm1d56mp', 'board_relation_mm0hf0y3',
      'lookup_mm0pd55m', 'lookup_mm0mbkjk'], V),
    ...vis(['color_mm0md4z8', 'date_mm0mwqzw', 'project_owner', 'file_mm0hcrtz',
      'file_mm1dm11c', 'file_mm0hj9pn', 'file_mm1g7cqz', 'file_mm0hayh4',
      'date_mm21c5ka', 'multiple_person_mm164em1', 'multiple_person_mm16qysk',
      'multiple_person_mm169k2f', 'file_mm478mkq', 'link_mm462saa',
      'text_mm4cct6a', 'text_mm4cdyjb', 'text_mm4c74f8', 'color_mm52csps',
      'file_mm4pa2h8', 'date_mm525k42', 'file_mm3393nf'], AC),
  },

  proyectos_sub: {
    ...vis(['name', 'text_mm0hs17x', 'text_mm0h4a1c', 'numeric_mm0hj2q4',
      'text_mm1antcb', 'text_mm1a5yyq', 'text_mm0hyrfs', 'color_mm0hqf79',
      'text_mm20gzsb', 'text_mm52x1bx', 'text_mm56dbkm', 'text_mm0mzet0',
      'date_mm20xdtm', 'date_mm20fq6t', 'date_mm20y5t3', 'date_mm21p1ex',
      'date_mm217ms0', 'date_mm21w46m', 'date_mm20t4kr', 'date_mm21swc5',
      'long_text_mm1cqh8e', 'long_text_mm1cyqts', 'long_text_mm1c59cg',
      'long_text_mm1c2eyf', 'long_text_mm1cyq91', 'long_text_mm1c6ya0',
      'long_text_mm1cnbbr', 'long_text_mm2077h1'], V),   // incl. 8 zonas embellecimiento
    ...vis(['numeric_mm1dj4fp', 'numeric_mm1dmsaz', 'text_mm1gdsvg',
      'board_relation_mm1cfgv5', 'lookup_mm1d2y9b', 'lookup_mm2145g',
      'multiple_person_mm4pc2ns', 'text_mm4ph3a9', 'text_mm4pywyx',
      'file_mm4pz90b', 'file_mm4pc4tj', 'file_mm4pfh5q', 'boolean_mm4p7eqb',
      'date_mm4p59q2'], AC),
  },

  productos: {
    ...vis(['name', 'product_and_service_sku', 'product_and_service_description',
      'dropdown_mkztty4b', 'text_mkzp9428', 'text_mkzpbhb5', 'long_text_mm0xse7v',
      'dropdown_mm07pjsv', 'text_mm0wvga2', 'long_text_mm174q0j'], V),
    ...vis(['numeric_mkzpx7eb', 'text_mkzp59zf', 'numeric_mm0bnkch',
      'numeric_mm0bgd2f', 'long_text_mm1tcga0', 'board_relation_mm1cwqky',
      'lookup_mm1cyy7f', 'lookup_mm1dv3jy', 'text_mkzmgvc7'], AC),
  },

  instituciones: {
    ...vis(['name', 'account_contact', 'text_mm1bvz12', 'dropdown_mm1bajsm',
      'dropdown_mm1brkww', 'dropdown_mm1b46m9', 'text_mm0canq', 'text_mm0cdqv2',
      'text_mm0c7qw1', 'date_mm0cv76t', 'multiple_person_mm0c3xbk',
      'board_relation_mm0ha84m', 'file_mm0ccv71'], V),
    ...vis(['numeric_mm1bv7zf', 'numeric_mm1bgv1p', 'text_mm1bped1'], AC),
  },

  contactos: {
    ...vis(['name', 'multiple_person_mm03vqwx', 'contact_email',
      'contact_phone', 'text_mm0dz8yj', 'long_text4', 'text_mm454qq1',
      'text_mm45xn3', 'text_mm45tqrm', 'text_mm456fbp', 'text_mm562a0m'], V),
    // Writable since the 2025-04 API bump fixed board_relation writes to this
    // CRM "Account" column (silently no-op'd on 2024-10) — verified live 2026-07-14.
    contact_account: { vis: V, w: WV },   // Institución
  },
};

export const canRead = (b: BoardSlug, col: string, r: Role) =>
  r !== 'cliente' && !!VISIBILITY[b][col]?.vis.includes(r);
export const canWrite = (b: BoardSlug, col: string, r: Role) =>
  !!VISIBILITY[b][col]?.w?.includes(r);
export const readableCols = (b: BoardSlug, r: Role): string[] =>
  Object.entries(VISIBILITY[b]).filter(([, c]) => c.vis.includes(r)).map(([id]) => id);
