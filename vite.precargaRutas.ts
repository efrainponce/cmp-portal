// vite.precargaRutas.ts — `modulepreload` de los chunks de la RUTA de
// aterrizaje, desde index.html (2026-10-08, plan CWV paso 3).
//
// Medido en producción con la red de Mérida (0.7 Mbps / 400 ms): el navegador
// bajaba index.js (86 KB gz) y SOLO cuando corría descubría los ~15 chunks de
// la pantalla (StageBoard, StageBoardList, GroupCard, Button…), que salían
// todos juntos a los 2.9 s: una vuelta entera de red (~0.9 s) antes de poder
// pintar la lista. Vite ya hace modulepreload de lo que index.js importa
// ESTÁTICO; lo de las vistas `lazy()` de App.tsx no lo puede saber, porque
// depende de la URL. Este plugin arma, al construir, el mapa ruta → chunks (la
// vista + todo lo que importa estático, recursivo) y lo mete en un script
// inline que agrega los <link rel=modulepreload> de la ruta actual mientras el
// HTML todavía se está leyendo. En un enlace directo a un item agrega además
// el chunk del drawer.
//
// La tabla de abajo calca el `activeBoard === …` de src/App.tsx. Si una ruta
// no está, no pasa nada: se carga como siempre (sin precarga).
import type { Plugin } from 'vite';

/** Vista lazy de App.tsx → rutas que la pintan. '' = "/" (aterriza en
 * Oportunidades o en Costeo según el menú del rol: van las dos). */
export const VISTAS: Record<string, string[]> = {
  'src/boards/oportunidades/OportunidadesBoard.tsx': ['oportunidades', ''],
  'src/boards/oportunidades/StageBoard.tsx': ['oportunidades_web', 'costeo', 'validacion', 'zona_efrain', ''],
  'src/boards/proyectos/ProyectoBoard.tsx': ['doctallas', 'ordenescompra', 'ejecucion', 'logistica', 'zona_efrain_proy', 'estadocuenta'],
  'src/boards/proyectos/OcListaBoard.tsx': ['oc_lista'],
  'src/boards/oportunidades/CotListaBoard.tsx': ['cot_lista'],
  'src/boards/muestras/MuestrasBoard.tsx': ['muestras'],
  'src/boards/generic/GenericBoardView.tsx': ['productos', 'instituciones', 'contactos', 'proveedores'],
  'src/boards/inventario/InventarioBoard.tsx': ['inventario'],
  'src/app/SettingsPage.tsx': ['settings'],
  'src/app/AnunciosView.tsx': ['anuncios'],
  'src/app/AnalisisPage.tsx': ['analisis'],
};

/** Drawer que se abre en un enlace directo (`/<ruta>/<id>`). */
export const DRAWERS: Record<string, string[]> = {
  'src/boards/oportunidades/OpportunityDrawer.tsx': ['oportunidades', 'oportunidades_web', 'costeo', 'validacion', 'zona_efrain'],
  'src/boards/proyectos/ProyectoDrawer.tsx': ['doctallas', 'ordenescompra', 'ejecucion', 'logistica', 'zona_efrain_proy', 'estadocuenta'],
};

interface ChunkMin { type: 'chunk'; fileName: string; imports: string[]; facadeModuleId: string | null; moduleIds?: string[]; isEntry: boolean }

/** El chunk de `modulo` + sus imports estáticos (recursivo), menos lo que ya
 * precarga Vite por ser del entry. */
export function chunksDe(modulo: string, bundle: Record<string, { type: string }>, raiz: string, delEntry: Set<string>): string[] {
  const chunks = Object.values(bundle).filter((c): c is ChunkMin => c.type === 'chunk') as ChunkMin[];
  const abs = `${raiz}/${modulo}`;
  const propio = chunks.find(c => c.facadeModuleId === abs) ?? chunks.find(c => c.moduleIds?.includes(abs));
  if (!propio) return [];
  const porNombre = new Map(chunks.map(c => [c.fileName, c]));
  const vistos = new Set<string>();
  const pila = [propio.fileName];
  while (pila.length) {
    const f = pila.pop()!;
    if (vistos.has(f) || delEntry.has(f)) continue;
    vistos.add(f);
    for (const i of porNombre.get(f)?.imports ?? []) pila.push(i);
  }
  return [...vistos];
}

export function precargaRutas(): Plugin {
  let raiz = '';
  let base = '/';
  return {
    name: 'cmp-precarga-rutas',
    apply: 'build',
    configResolved(c) { raiz = c.root; base = c.base; },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle as Record<string, { type: string }> | undefined;
        if (!bundle) return html;
        const chunks = Object.values(bundle).filter((c): c is ChunkMin => c.type === 'chunk') as ChunkMin[];
        // Lo que index.js importa estático ya lleva su modulepreload de Vite.
        const delEntry = new Set<string>();
        for (const e of chunks.filter(c => c.isEntry)) {
          const pila = [e.fileName];
          while (pila.length) {
            const f = pila.pop()!;
            if (delEntry.has(f)) continue;
            delEntry.add(f);
            for (const i of chunks.find(c => c.fileName === f)?.imports ?? []) pila.push(i);
          }
        }
        const lista: string[] = [];
        const idx = (f: string) => { let i = lista.indexOf(f); if (i < 0) { i = lista.length; lista.push(f); } return i; };
        const rutas: Record<string, number[]> = {};
        const drawers: Record<string, number[]> = {};
        const meter = (mapa: Record<string, string[]>, destino: Record<string, number[]>) => {
          for (const [modulo, rs] of Object.entries(mapa)) {
            const fs = chunksDe(modulo, bundle, raiz, delEntry);
            if (!fs.length) this.warn?.(`precargaRutas: no encontré el chunk de ${modulo}`);
            for (const r of rs) destino[r] = [...new Set([...(destino[r] ?? []), ...fs.map(idx)])];
          }
        };
        meter(VISTAS, rutas);
        meter(DRAWERS, drawers);
        const script = `(function(){try{var F=${JSON.stringify(lista)},R=${JSON.stringify(rutas)},D=${JSON.stringify(drawers)};`
          + `var s=location.pathname.split('/'),k=s[1]||'',ids=(R[k]||[]).concat(s[2]?(D[k]||[]):[]);`
          + `for(var i=0;i<ids.length;i++){var l=document.createElement('link');l.rel='modulepreload';l.href=${JSON.stringify(base)}+F[ids[i]];document.head.appendChild(l);}`
          + `}catch(e){}})();`;
        return [{ tag: 'script', children: script, injectTo: 'head' }];
      },
    },
  };
}
