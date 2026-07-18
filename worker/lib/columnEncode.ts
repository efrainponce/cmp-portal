// Encode a plain form value into the JSON shape Monday's create_item /
// change_multiple_column_values mutations expect per column type. Distinct from
// canon.ts's canonValue(), which normalizes Monday's *read* shape for hashing —
// writing complex types (people/board_relation/date/email/phone) needs the
// structured object, not a flattened string. Used by both the create-item route
// and the edit/outbox write path (worker/lib/outbox.ts's flushOne).

export function encodeColumnValue(type: string, raw: string): unknown {
  const value = raw.trim();
  if (type === 'board_relation') {
    // {item_ids:[...]} is the correct shape for both plain connect_boards
    // columns and Monday CRM-template "Account" relation columns (e.g.
    // Contactos' contact_account) — the latter silently no-op'd on API
    // version 2024-10 but works on 2025-04+ (verified live 2026-07-14). Clearing
    // needs item_ids:[] specifically — a bare '' is rejected as an invalid
    // column value structure.
    return { item_ids: value === '' ? [] : [Number(value)] };
  }
  if (type === 'checkbox') {
    // Igual que board_relation arriba: un '' plano lo rechaza ("invalid value…")
    // y {} da "Invalid column type value" — Monday quiere JSON null para
    // desmarcar (verificado en vivo 2026-07-18; docs: api.developer.monday.com/docs/checkbox).
    return value === '' ? null : { checked: 'true' };
  }
  if (value === '') return '';
  switch (type) {
    case 'date':
      return { date: value };
    case 'email':
      return { email: value, text: value };
    case 'phone': {
      // Form sends "CC:number" (see FormField.tsx's phone country selector).
      const i = value.indexOf(':');
      const country = i === -1 ? 'MX' : value.slice(0, i);
      const number = (i === -1 ? value : value.slice(i + 1)).trim();
      if (number === '') return '';
      return { phone: number, countryShortName: country || 'MX' };
    }
    case 'people':
      return { personsAndTeams: [{ id: Number(value), kind: 'person' }] };
    case 'status':
      // Status quiere {label} singular — {labels:[...]} es el shape de dropdown;
      // Monday no lo rechaza pero asigna un label arbitrario (visto en vivo
      // 2026-07-15: deal_stage terminó en "Cancelada").
      return { label: value };
    case 'dropdown':
      return { labels: [value] };
    default:
      return value; // text, long_text, name
  }
}
