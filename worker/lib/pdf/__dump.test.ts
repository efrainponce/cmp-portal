import { it } from 'vitest';
import { renderTemplate, type CosteoValidacionData } from './templates';
const data: CosteoValidacionData = {
  kind: 'validacion-costeo', nombre: 'OPP-0913 - Sureste/ FGE CAMP - Arma no letal', folio: 'OPP-0913',
  institucion: 'Fiscalía del estado de Campeche', vendedor: 'Angel Omar Canto Cural', zona: 'Sureste',
  lineas: [{ producto: 'Pistola P2P SECURE 68P Negra/Naranja Cal. .68 350fps PEPPER', sku: '2292329', color: 'negro',
    cantidad: 25, moneda: 'MXN', costoDistr: 0, descuentoPct: 0, costoReal: 5972, conversion: 0, gastosPct: 0,
    costoEmbellecimiento: 0, costoTotal: 6270.6, techo: 0, precioSugerido: 0, precioVenta: 2490, subtotal: 62250,
    margenGobPct: 15, margenGobTotal: 9337.5, utilidad: -103852.5, utilidadPct: -166.83 }],
  subtotal: 62250, utilidad: -103852.5,
};
it('dump', async () => {
  const bytes = renderTemplate({ docId: 'doc-test', data, generatedAt: '2026-08-18T16:31:23.071Z', signatures: [] });
  const txt = new TextDecoder('latin1').decode(bytes).replace(/<< \/Type \/XObject[\s\S]*?stream\r?\n[\s\S]*?endstream/g, '');
  console.log([...txt.matchAll(/\((?:[^()\\]|\\.)*\)/g)].map(m => m[0]).join(' | '));
  const fs = await import('node:fs');
  fs.writeFileSync('/private/tmp/claude-501/-Users-efrain-Documents-dev-cmp-portal/9effe49a-cbd4-4299-b6ed-3f7e1dc0b4d6/scratchpad/validacion.pdf', bytes);
});
