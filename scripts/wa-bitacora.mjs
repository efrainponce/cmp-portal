#!/usr/bin/env node
// scripts/wa-bitacora.mjs — ¿Qué pasó con fulano en WhatsApp? Línea de tiempo
// de UNA persona (o el gasto por persona si no se da correo), leída de D1 de
// producción (docs/plan-wa-cartera.md §8, Efraín 2026-09-12: "necesitamos log
// de todo").
//
//   node scripts/wa-bitacora.mjs --correo vendedor@mexicanadeproteccion.com
//   node scripts/wa-bitacora.mjs --correo x@… --dias 7
//   node scripts/wa-bitacora.mjs                # gasto del modelo por persona, 7 días
//
// Fuentes: wa_mensaje (lo que mandamos y si Meta lo entregó/leyó),
// wa_entrante (cada mensaje que llegó y quién lo atendió), agente_evento
// (cada llamada al modelo con tokens/costo y cada tool), wa_resumen (el
// resumen matutino, mandado o no y por qué), wa_preferencias_log.
// Necesita `.dev.vars` en la raíz, como el resto de scripts.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const correo = arg('--correo', null);
const dias = Math.max(1, Number(arg('--dias', 7)) || 7);
const desde = new Date(Date.now() - dias * 86_400_000).toISOString();

function d1(sql) {
  try {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--remote', '--env-file=.dev.vars', '--json', '--command', sql],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CLOUDFLARE_API_TOKEN: undefined } });
    return JSON.parse(out)[0]?.results ?? [];
  } catch (err) {
    const msg = String(err?.stdout || err?.message || err);
    if (/no such table/i.test(msg)) return [];
    throw err;
  }
}
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const corto = (s, n = 110) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const hora = iso => iso.slice(5, 16).replace('T', ' ');

if (!correo) {
  console.log(`Gasto del modelo por persona — últimos ${dias} días`);
  const costos = d1(`SELECT email, canal, COUNT(*) AS llamadas, ROUND(COALESCE(SUM(costo_usd),0), 4) AS usd,
      SUM(tokens_in) AS tin, SUM(tokens_cache) AS tcache, SUM(tokens_out) AS tout
    FROM agente_evento WHERE tipo = 'llamada' AND created_at >= ${q(desde)} GROUP BY email, canal ORDER BY usd DESC`);
  if (costos.length === 0) console.log('  (sin llamadas registradas)');
  for (const c of costos) console.log(`  ${c.email.padEnd(45)} ${c.canal.padEnd(9)} ${String(c.llamadas).padStart(4)} llamadas  $${c.usd}  (${c.tin ?? 0} in + ${c.tcache ?? 0} caché → ${c.tout ?? 0} out)`);
  const router = d1(`SELECT CASE WHEN atendido_por LIKE 'router:%' THEN 'router' WHEN atendido_por = 'agente' THEN 'agente' ELSE 'rechazado' END AS quien, COUNT(*) AS n
    FROM wa_entrante WHERE created_at >= ${q(desde)} GROUP BY quien`);
  if (router.length) console.log('\nEntrantes: ' + router.map(r => `${r.quien}=${r.n}`).join(', '));
  const resumenes = d1(`SELECT enviado, COALESCE(motivo, '') AS motivo, COUNT(*) AS n FROM wa_resumen WHERE created_at >= ${q(desde)} GROUP BY enviado, motivo ORDER BY n DESC`);
  if (resumenes.length) {
    console.log('\nResúmenes matutinos:');
    for (const r of resumenes) console.log(`  ${r.enviado ? 'enviado' : 'NO enviado'} ${r.motivo ? `(${corto(r.motivo, 60)})` : ''}: ${r.n}`);
  }
  process.exit(0);
}

console.log(`Línea de tiempo de ${correo} — últimos ${dias} días (UTC)`);
const eventos = [];
for (const r of d1(`SELECT tipo, titulo, estado, error, created_at, leido_at FROM wa_mensaje WHERE email = ${q(correo)} AND created_at >= ${q(desde)} ORDER BY created_at LIMIT 300`)) {
  eventos.push({ at: r.created_at, linea: `📤 [${r.tipo}] ${r.estado}${r.leido_at ? ' (leído)' : ''}: ${corto(r.titulo)}${r.error ? ` ✗ ${corto(r.error, 80)}` : ''}` });
}
for (const r of d1(`SELECT tipo, texto, atendido_por, respuesta, latencia_ms, error, created_at FROM wa_entrante WHERE email = ${q(correo)} AND created_at >= ${q(desde)} ORDER BY created_at LIMIT 300`)) {
  eventos.push({ at: r.created_at, linea: `📥 "${corto(r.texto, 90)}" → ${r.atendido_por} (${r.latencia_ms ?? '?'} ms)${r.error ? ` ✗ ${corto(r.error, 80)}` : ''}` });
}
for (const r of d1(`SELECT canal, tipo, tool, input, resultado, is_error, costo_usd, tokens_in, tokens_cache, tokens_out, ms, created_at FROM agente_evento WHERE email = ${q(correo)} AND created_at >= ${q(desde)} ORDER BY created_at LIMIT 300`)) {
  eventos.push({
    at: r.created_at,
    linea: r.tipo === 'llamada'
      ? `   🤖 ${r.canal} llamada: ${r.tokens_in ?? 0}+${r.tokens_cache ?? 0}c → ${r.tokens_out ?? 0} tokens, $${(r.costo_usd ?? 0).toFixed(4)}, ${r.ms ?? '?'} ms`
      : `   🔧 ${r.tool}${r.is_error ? ' ✗' : ''} ${corto(r.input, 70)} → ${corto(r.resultado, 60)}`,
  });
}
for (const r of d1(`SELECT fecha, enviado, motivo, item_ids, candidata_id, created_at FROM wa_resumen WHERE email = ${q(correo)} AND created_at >= ${q(desde)} ORDER BY created_at`)) {
  eventos.push({ at: r.created_at, linea: `🌅 resumen ${r.fecha}: ${r.enviado ? 'enviado' : 'NO enviado'}${r.motivo ? ` (${corto(r.motivo, 80)})` : ''} ids=${r.item_ids} candidata=${r.candidata_id ?? '-'}` });
}
for (const r of d1(`SELECT campo, antes, despues, por, origen, created_at FROM wa_preferencias_log WHERE email = ${q(correo)} AND created_at >= ${q(desde)} ORDER BY created_at`)) {
  eventos.push({ at: r.created_at, linea: `⚙️ ${r.campo}: ${r.antes ?? '-'} → ${r.despues ?? '-'} (${r.origen}, ${r.por})` });
}
eventos.sort((a, b) => a.at.localeCompare(b.at));
if (eventos.length === 0) console.log('  (nada en ese rango)');
for (const e of eventos) console.log(`${hora(e.at)}  ${e.linea}`);
