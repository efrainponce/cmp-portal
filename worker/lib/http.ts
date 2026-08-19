// Helper mínimo compartido por los módulos de rutas (worker/routes/*).
export function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Rechaza query params que la ruta no conoce, en vez de ignorarlos en silencio.
 *
 * Nace del incidente del 2026-08-18: un script de verificación limpió su rastro
 * con `GET /boards/oportunidades_sub/items?parent=<opp>` creyendo pedir las
 * líneas de UNA oportunidad. `parent` no existe en esa ruta (solo `q` y `cols`),
 * se ignoró sin decir nada, la respuesta trajo el board COMPLETO y el loop de
 * borrado que venía después se llevó 70 líneas de 22 oportunidades.
 *
 * La lección no es "ese script estaba mal" — es que un filtro mal escrito no
 * debe degradar a "sin filtro". En una ruta de LISTA eso convierte un error de
 * tecleo en un barrido del board entero, así que el default correcto es fallar
 * ruidoso: quien pide un filtro que no existe se lleva un 400, no todo.
 *
 * Devuelve la respuesta de error si hay algo desconocido, o `null` si la query
 * está limpia (el caller sigue con `if (bad) return bad;`).
 */
export function rejectUnknownQuery(url: string, allowed: readonly string[]): Response | null {
  const params = new URL(url).searchParams;
  const desconocidos = [...new Set([...params.keys()])].filter(k => !allowed.includes(k));
  if (desconocidos.length === 0) return null;
  return jsonStatus({
    error: `query param no soportado: ${desconocidos.join(', ')}. Esta ruta acepta: ${allowed.join(', ') || '(ninguno)'}`,
  }, 400);
}
