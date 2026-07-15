// Whitelist-as-data for item CREATION, same spirit as shared/visibility.ts but a
// separate concern: which columns may be filled in when making a new record, in
// what order, and which are required. Fail-closed — a colId not listed here is
// rejected by the create route even if it's readable/writable for edits.
// PROPOSED 2026-07-14, pending Efraín's review (see docs/monday-column-map.md).

export interface CreateField { id: string; required?: boolean }

export const CREATE_FIELDS: Record<'instituciones' | 'contactos' | 'oportunidades', CreateField[]> = {
  // Requested by Efraín 2026-07-15: exactly these fields, "super fácil". Product
  // lines are NOT captured at creation — the enviar-costeo validation blocks the
  // costeo hand-off until lines with cantidad y color válido exist.
  oportunidades: [
    { id: 'name', required: true },
    { id: 'deal_owner', required: true },       // Vendedor (authz key)
    { id: 'multiple_person_mm03qyw9' },         // Compras
    { id: 'deal_contact' },                     // Contacto (cliente) → Contactos
    { id: 'dropdown_mm03g067' },                // Zona
    { id: 'color_mm47f0ca' },                   // Tipo de cotización
    { id: 'color_mm0ex0ed' },                   // ¿Quieres cotizar nuevos productos?
    { id: 'deal_expected_close_date' },         // Fecha límite
  ],
  instituciones: [
    { id: 'name', required: true },
    { id: 'dropdown_mm1bajsm', required: true }, // Tipo
    { id: 'dropdown_mm1b46m9', required: true }, // Estado
    { id: 'text_mm1bvz12' },       // Municipio
    { id: 'dropdown_mm1brkww' },   // Grupo
    { id: 'text_mm0canq' },        // RFC
    { id: 'text_mm0cdqv2' },       // Domicilio Fiscal
    { id: 'text_mm0c7qw1' },       // Régimen Fiscal
    { id: 'date_mm0cv76t' },       // Fin de Administración
    { id: 'multiple_person_mm0c3xbk' }, // Vendedor
  ],
  contactos: [
    { id: 'name', required: true },
    // Institución (contact_account) intentionally excluded from creation for now —
    // it's editable after creation (see shared/visibility.ts) but wiring it into the
    // create form is a separate change (needs an Instituciones picker in FormField).
    { id: 'contact_email' },
    { id: 'contact_phone' },
    { id: 'text_mm0dz8yj' },       // Cargo
    { id: 'multiple_person_mm03vqwx' }, // Vendedor
    { id: 'long_text4' },          // Comentarios
  ],
};

// Server-side values stamped on every new record of a board — never client-sent
// (deal_stage isn't in CREATE_FIELDS, so the route rejects it if the client tries).
export const CREATE_DEFAULTS: Partial<Record<keyof typeof CREATE_FIELDS, Record<string, string>>> = {
  oportunidades: { deal_stage: 'Nueva oportunidad' },
};

export const CREATABLE_SLUGS = Object.keys(CREATE_FIELDS) as (keyof typeof CREATE_FIELDS)[];

export function isCreatable(slug: string): slug is keyof typeof CREATE_FIELDS {
  return Object.prototype.hasOwnProperty.call(CREATE_FIELDS, slug);
}
