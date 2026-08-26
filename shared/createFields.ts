// Whitelist-as-data for item CREATION, same spirit as shared/visibility.ts but a
// separate concern: which columns may be filled in when making a new record, in
// what order, and which are required. Fail-closed — a colId not listed here is
// rejected by the create route even if it's readable/writable for edits.
// PROPOSED 2026-07-14, pending Efraín's review (see docs/monday-column-map.md).

export interface CreateField { id: string; required?: boolean }

export const CREATE_FIELDS: Record<'instituciones' | 'contactos' | 'oportunidades' | 'proyectos', CreateField[]> = {
  // Requested by Efraín 2026-07-15: exactly these fields, "super fácil". Product
  // lines are NOT captured at creation — the enviar-costeo validation blocks the
  // costeo hand-off until lines with cantidad y color válido exist.
  oportunidades: [
    { id: 'name', required: true },
    { id: 'deal_owner', required: true },       // Vendedor (authz key)
    { id: 'multiple_person_mm0wt53c' },         // Vendedor secundario (authz key también)
    // required desde 2026-08-10 (Efraín): STAGE_NOTIFY ahora notifica SOLO al
    // comprador asignado aquí (antes 'role:compras' avisaba a todo el equipo),
    // así que una oportunidad sin Compras se queda sin avisar a nadie.
    { id: 'multiple_person_mm03qyw9', required: true }, // Compras
    { id: 'deal_contact' },                     // Contacto (cliente) → Contactos
    { id: 'dropdown_mm03g067' },                // Zona
    { id: 'color_mm47f0ca' },                   // Tipo de cotización
    { id: 'color_mm0ex0ed' },                   // ¿Quieres cotizar nuevos productos?
    { id: 'deal_expected_close_date' },         // Fecha límite
  ],
  // Proyecto "desde cero", SIN Oportunidad ligada (Efraín, 2026-08-26): hasta
  // ahora un Proyecto solo nacía al GANAR una oportunidad
  // (worker/lib/ganarOportunidad.ts), y compras necesita poder levantar una OC
  // sin que haya habido una venta detrás. La columna Oportunidad
  // (board_relation_mm0hf0y3) NO está aquí a propósito: ligar se hace ganando
  // la oportunidad, y dejar que el form la eligiera abriría la puerta a dos
  // proyectos para la misma opp (el flujo de Ganar es idempotente justo para
  // evitar eso).
  //
  // Vendedor y Compras son OBLIGATORIOS porque son las dos llaves de scoping
  // del board (shared/boards.ts: authzCols = Vendedor, comprasCol = Compras,
  // worker/lib/dal.ts): un proyecto sin ellas sería invisible hasta para quien
  // lo acaba de crear — el mismo hoyo que ya se tapó en Contactos.
  proyectos: [
    { id: 'name', required: true },
    { id: 'multiple_person_mm0hrnqq', required: true }, // Vendedor (authz key)
    { id: 'project_owner', required: true },            // Compras (comprasCol)
    { id: 'board_relation_mm0hb0gy' },                  // Contacto → de ahí sale el espejo Institución
    { id: 'dropdown_mm0hnyv' },                         // Zona
    { id: 'date_mm0m1vfv' },                            // Fecha Entrega
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
    // Efraín, 2026-08-05: todos los campos obligatorios excepto Comentarios.
    // contact_account es required aquí pero se valida a mano en
    // CreateRecordModal (no pasa por el loop genérico de requiredFields): el
    // picker vive ahí, no en FormField genérico, porque es un board_relation
    // que necesita buscar sobre `instituciones` en vivo, mismo patrón que ya
    // usaba EditContactoModal para reasignarla después.
    { id: 'contact_account', required: true },
    { id: 'contact_email', required: true },
    { id: 'contact_phone', required: true },
    { id: 'text_mm0dz8yj', required: true },       // Cargo
    { id: 'multiple_person_mm03vqwx', required: true }, // Vendedor
    { id: 'long_text4' },          // Comentarios
  ],
};

// Server-side values stamped on every new record of a board — never client-sent
// (deal_stage isn't in CREATE_FIELDS, so the route rejects it if the client tries).
export const CREATE_DEFAULTS: Partial<Record<keyof typeof CREATE_FIELDS, Record<string, string>>> = {
  oportunidades: { deal_stage: 'Nueva oportunidad' },
  // Etapa inicial del post-venta. En un Proyecto creado por Monday la estampa
  // el board solo; uno creado por API nace SIN valor y eso lo deja INVISIBLE en
  // todos los accesos del sidebar (src/lib/projectStages.ts filtra por
  // project_status y un item sin valor no cae en ningún grupo) — el mismo
  // hallazgo que ya está anotado en worker/lib/ganarOportunidad.ts.
  proyectos: { project_status: 'Desglose de tallas' },
};

export function isCreatable(slug: string): slug is keyof typeof CREATE_FIELDS {
  return Object.prototype.hasOwnProperty.call(CREATE_FIELDS, slug);
}
