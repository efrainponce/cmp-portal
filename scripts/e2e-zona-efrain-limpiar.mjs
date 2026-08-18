// Borra el rastro de las pruebas E2E en producción. Los items nativos no
// existen en Monday, así que el DELETE del portal solo toca D1.
import { abrirContexto, sesionValida, PROD } from '/Users/efrain/Documents/dev/cmp-portal/scripts/prod-login.mjs';
const ctx = await abrirContexto({ headless: true });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await sesionValida(page); await page.goto(PROD, { waitUntil: 'domcontentloaded' });
const api = (m,p)=>page.evaluate(async ([m,p])=>{const r=await fetch('/api'+p,{method:m});const t=await r.text();let j=null;try{j=JSON.parse(t);}catch{};return{status:r.status,json:j};},[m,p]);
const NATIVO = 900000000000;
const esPrueba = (n) => (n||'').startsWith('PRUEBA E2E ZONA EFRAIN');

const opps = (await api('GET','/boards/oportunidades/items')).json.items.filter(i => Number(i.id) >= NATIVO && esPrueba(i.name));
const proys = (await api('GET','/boards/proyectos/items')).json.items.filter(i => Number(i.id) >= NATIVO && esPrueba(i.name));
const oppIds = new Set(opps.map(o => o.id));
const proyIds = new Set(proys.map(p => p.id));
const lineas = (await api('GET','/boards/oportunidades_sub/items')).json.items.filter(i => oppIds.has(String(i.parentId)));
const tallas = (await api('GET','/boards/proyectos_sub/items')).json.items.filter(i => proyIds.has(String(i.parentId)));
console.log(`a borrar: ${opps.length} oportunidades, ${lineas.length} líneas, ${proys.length} proyectos, ${tallas.length} líneas de talla`);

let ok = 0, fail = 0;
for (const grupo of [[ 'oportunidades_sub', lineas ], [ 'proyectos_sub', tallas ], [ 'oportunidades', opps ], [ 'proyectos', proys ]]) {
  const [slug, items] = grupo;
  for (const it of items) {
    const r = await api('DELETE', `/boards/${slug}/items/${it.id}`);
    if (r.status === 200) ok++; else { fail++; console.log('  ✗', slug, it.id, r.status, JSON.stringify(r.json).slice(0,90)); }
  }
}
console.log(`borrados: ${ok} · fallidos: ${fail}`);
const quedan = (await api('GET','/boards/oportunidades/items')).json.items.filter(i => Number(i.id) >= NATIVO);
console.log('items nativos que quedan en Oportunidades:', quedan.map(i => `${i.id} "${i.name}"`).join(' | ') || '(ninguno)');
await ctx.close();
