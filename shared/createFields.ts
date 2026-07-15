// Whitelist-as-data for item CREATION, same spirit as shared/visibility.ts but a
// separate concern: which columns may be filled in when making a new record, in
// what order, and which are required. Fail-closed — a colId not listed here is
// rejected by the create route even if it's readable/writable for edits.
// PROPOSED 2026-07-14, pending Efraín's review (see docs/monday-column-map.md).

export interface CreateField { id: string; required?: boolean }

export const CREATE_FIELDS: Record<'instituciones' | 'contactos', CreateField[]> = {
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

export const CREATABLE_SLUGS = Object.keys(CREATE_FIELDS) as (keyof typeof CREATE_FIELDS)[];

export function isCreatable(slug: string): slug is keyof typeof CREATE_FIELDS {
  return Object.prototype.hasOwnProperty.call(CREATE_FIELDS, slug);
}
