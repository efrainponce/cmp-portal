// Emparejar las ZONAS de embellecimiento de la cotización (texto por línea de
// producto, shared/embellecimiento.ts) con las LÍNEAS de embellecimiento del
// Proyecto (subitems "✨ <zona>" de proyectos_sub, los que arman la OC al
// bordador). Son dos mundos distintos y no hay id que los ligue:
//
//   - las zonas viven en la Oportunidad, una por producto,
//   - las líneas ✨ las creó "Importar tallas" (cmp-tallas) deduplicando
//     embellecimientos ÚNICOS, así que un mismo texto puede venir de varios
//     productos y un proyecto sí puede tener dos "✨ Espalda" con descripción
//     distinta (verificado en producción, 2026-08-25: 181 líneas ✨ en 28
//     proyectos, con nombres repetidos).
//
// Por eso el emparejamiento va por DESCRIPCIÓN primero (es lo que distingue a
// dos líneas de la misma zona) y solo cae al nombre de la zona cuando esa zona
// aparece una única vez. Lo que no empareja no se esconde: sale aparte, para
// que toda línea ✨ tenga dónde asignarle proveedor.
//
// Módulo puro a propósito (sin React ni DTOs): la lógica de emparejar es lo
// único que puede salir mal en silencio y así queda cubierta por vitest.

/** Una línea de embellecimiento del Proyecto, ya extraída del subitem. */
export interface EmbLinea {
  id: string;
  /** Nombre del subitem sin el prefijo "✨". */
  zona: string;
  /** Columna Producto del subitem: el texto de la posición. */
  descripcion: string;
}

/** Una zona de la cotización (label de plantilla + texto capturado). */
export interface ZonaRef {
  label: string;
  value: string;
}

export const EMB_PREFIX = '✨';

/** Un subitem del Proyecto es línea de embellecimiento si su nombre arranca con
 * "✨" — el mismo marcador que lee la OC (worker/lib/ocProveedorPdf.ts). */
export function esLineaEmbellecimiento(nombre: string): boolean {
  return nombre.trimStart().startsWith(EMB_PREFIX);
}

/** "✨ Frente derecho" -> "Frente derecho". */
export function zonaDeNombre(nombre: string): string {
  return nombre.trim().startsWith(EMB_PREFIX) ? nombre.trim().slice(EMB_PREFIX.length).trim() : nombre.trim();
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Llave estable de una zona de la cotización — dos productos con la misma
 * posición y el mismo texto comparten línea ✨, y eso es correcto: la línea del
 * proyecto es única por embellecimiento, no por producto. */
export function claveZona(z: ZonaRef): string {
  return `${norm(z.label)}|${norm(z.value)}`;
}

export interface Emparejamiento {
  /** claveZona -> línea ✨ del Proyecto que le corresponde. */
  porZona: Map<string, EmbLinea>;
  /** Líneas ✨ que ninguna zona reclamó (zonas fuera de plantilla como
   * "✨ Etiqueta nombre", o textos que ya no coinciden con la cotización). */
  sobrantes: EmbLinea[];
}

/** Empareja zonas de la cotización con líneas ✨ del Proyecto. Una línea puede
 * quedar asignada a varias zonas (mismo texto en varios productos); ninguna
 * zona toma dos líneas. */
export function emparejarEmbell(zonas: ZonaRef[], lineas: EmbLinea[]): Emparejamiento {
  const porZona = new Map<string, EmbLinea>();
  const usadas = new Set<string>();

  // Cuántas líneas comparten nombre de zona: el fallback por nombre solo es
  // seguro cuando es una sola (si hay dos "✨ Espalda" distintas, adivinar
  // pondría el proveedor del bordado equivocado).
  const porNombre = new Map<string, EmbLinea[]>();
  for (const l of lineas) {
    const k = norm(l.zona);
    porNombre.set(k, [...(porNombre.get(k) ?? []), l]);
  }

  for (const z of zonas) {
    const clave = claveZona(z);
    if (porZona.has(clave)) continue;
    const valor = norm(z.value);
    // 1) Misma descripción, aunque el nombre de la zona no case ("Manga
    //    derecha" en el Sheet vs "Manga derecha/costado derecho" en plantilla).
    let match = valor ? lineas.find((l) => norm(l.descripcion) === valor) : undefined;
    // 2) Si no, el nombre de la zona — solo si es inequívoco.
    if (!match) {
      const etiqueta = norm(z.label);
      const candidatas = [...porNombre.entries()]
        .filter(([k]) => k === etiqueta || (k.length > 3 && etiqueta.startsWith(k)) || (etiqueta.length > 3 && k.startsWith(etiqueta)))
        .flatMap(([, v]) => v);
      if (candidatas.length === 1) match = candidatas[0];
    }
    if (match) {
      porZona.set(clave, match);
      usadas.add(match.id);
    }
  }

  return { porZona, sobrantes: lineas.filter((l) => !usadas.has(l.id)) };
}
