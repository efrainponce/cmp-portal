// shared/firmaPortal.ts — separa la firma "— Fulano vía Portal CMP" de un
// comentario (update) escrito desde el portal.
//
// Monday atribuye TODO lo que escribe el portal al dueño del token de la API
// (Efraín), así que el `creator` de esos comentarios no dice quién los
// escribió: el autor real solo vive en la firma que agrega
// worker/lib/firmaUpdate.ts al final del texto. El feed de Actualizaciones la
// usa para dos cosas (Jorge, 2026-09-25): mostrar la burbuja y el nombre de
// quien SÍ escribió, y ocultar la firma en pantalla (ya se ve arriba).
//
// Solo lectura y solo para mostrar: el texto en Monday no se toca, y el
// webhook sigue reconociendo lo del portal por PORTAL_SIGNATURE
// (worker/lib/updateNotify.ts), que es la misma frase.

const FIRMA = /\s*—\s*@?([^\n—]+?)\s+vía Portal CMP\s*$/u;

export interface CuerpoFirmado {
  /** El comentario sin la firma. */
  texto: string;
  /** Quién lo escribió según la firma; null si no la trae (escrito en Monday). */
  autor: string | null;
}

export function separarFirma(body: string): CuerpoFirmado {
  const m = FIRMA.exec(body);
  if (!m) return { texto: body, autor: null };
  const autor = m[1].trim();
  // Un comentario hecho solo de firma (no debería pasar) conserva su texto
  // para no pintar una tarjeta vacía.
  const texto = body.slice(0, m.index).trimEnd();
  return { texto: texto || body, autor: autor || null };
}
