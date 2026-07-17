// Helper mínimo compartido por los módulos de rutas (worker/routes/*).
export function jsonStatus(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
