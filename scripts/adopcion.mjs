// scripts/adopcion.mjs — ¿quién sigue trabajando en Monday? (solo lectura, D1 de producción, últimos 30 días).
// Semáforo de cada ola de docs/plan-salida-monday.md. Misma atribución que worker/lib/uxMetrics.ts.
// Ojo: lo que el portal escribe sale en Monday firmado por el dueño del token (Efraín): su renglón mezcla ambos.
//   node scripts/adopcion.mjs
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env }; delete env.CLOUDFLARE_API_TOKEN;
function d1(sql) {
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync('npx', ['wrangler','d1','execute','cmp-portal','--remote','--env-file=.dev.vars','--json','--command', sql],
        { cwd: REPO, env, encoding: 'utf8', stdio: ['ignore','pipe','ignore'], maxBuffer: 64*1024*1024 });
      return JSON.parse(out)[0].results;
    } catch (e) { if (i === 2) throw e; }
  }
}
const ISO = `'%Y-%m-%dT%H:%M:%fZ'`;
const DESDE = new Date(Date.now() - 30*864e5).toISOString();
const CTE = `ediciones AS (
  SELECT a.board_id, a.item_id, a.column_id, a.column_title, a.user_id, a.created_at,
    CASE
      WHEN a.dedupe_key LIKE 'direct:%' THEN 'portal'
      WHEN a.item_id >= 900000000000 THEN 'portal'
      WHEN EXISTS (SELECT 1 FROM ux_event u WHERE u.kind='edit' AND u.item_id=a.item_id AND u.column_id=a.column_id AND u.user_id=a.user_id
        AND u.created_at >= strftime(${ISO}, a.created_at, '-15 minutes') AND u.created_at <= strftime(${ISO}, a.created_at, '+2 minutes')) THEN 'portal'
      WHEN EXISTS (SELECT 1 FROM outbox o JOIN identity i ON i.email=o.author_email
        WHERE o.board_id=a.board_id AND o.item_id=a.item_id AND i.monday_user_id=a.user_id AND o.cols LIKE '%"'||a.column_id||'"%'
        AND o.created_at >= strftime(${ISO}, a.created_at, '-15 minutes') AND o.created_at <= strftime(${ISO}, a.created_at, '+2 minutes')) THEN 'portal'
      ELSE 'monday' END AS origen
  FROM activity_log a
  WHERE a.event='update_column_value' AND a.column_id IS NOT NULL AND a.user_id > 0 AND a.created_at >= '${DESDE}')`;
const show = (t, rows) => { console.log('\n## ' + t); console.table(rows); };
show('Por semana', d1(`WITH ${CTE} SELECT strftime('%Y-W%W',created_at) sem, SUM(origen='portal') portal, SUM(origen='monday') monday,
  COUNT(DISTINCT CASE WHEN origen='monday' THEN user_id END) personas_monday FROM ediciones GROUP BY sem ORDER BY sem`));
show('Por persona (30 d)', d1(`WITH ${CTE} SELECT e.user_id, (SELECT MIN(i.nombre) FROM identity i WHERE i.monday_user_id=e.user_id) nombre,
  (SELECT MIN(i.role) FROM identity i WHERE i.monday_user_id=e.user_id) rol,
  SUM(origen='portal') portal, SUM(origen='monday') monday, MAX(CASE WHEN origen='monday' THEN created_at END) ultima_monday
  FROM ediciones e GROUP BY e.user_id ORDER BY monday DESC`));
show('Monday: por board+columna (top 40)', d1(`WITH ${CTE} SELECT board_id, column_id, MIN(column_title) titulo, COUNT(*) n, COUNT(DISTINCT user_id) personas
  FROM ediciones WHERE origen='monday' GROUP BY board_id, column_id ORDER BY n DESC LIMIT 40`));
show('Monday: por board', d1(`WITH ${CTE} SELECT board_id, COUNT(*) n, COUNT(DISTINCT user_id) personas FROM ediciones WHERE origen='monday' GROUP BY board_id ORDER BY n DESC`));
show('Otros eventos en Monday (no columnas) 30 d', d1(`SELECT event, COUNT(*) n FROM activity_log WHERE created_at >= '${DESDE}' AND user_id>0 AND dedupe_key NOT LIKE 'direct:%' GROUP BY event ORDER BY n DESC`));
show('Sesiones portal por persona (ux_event 30 d)', d1(`SELECT u.user_id, (SELECT MIN(i.nombre) FROM identity i WHERE i.monday_user_id=u.user_id) nombre, COUNT(DISTINCT substr(u.created_at,1,10)) dias_activos, COUNT(*) eventos FROM ux_event u WHERE u.created_at >= '${DESDE}' AND u.kind != 'perf' GROUP BY u.user_id ORDER BY dias_activos DESC`));
show('Outbox (writes del portal) por autor 30 d', d1(`SELECT author_email, COUNT(*) n, COUNT(DISTINCT substr(created_at,1,10)) dias, MAX(created_at) ultimo FROM outbox WHERE created_at >= '${DESDE}' GROUP BY author_email ORDER BY n DESC`));
show('Outbox por semana', d1(`SELECT strftime('%Y-W%W',created_at) sem, COUNT(*) n, COUNT(DISTINCT author_email) autores FROM outbox WHERE created_at >= '${DESDE}' GROUP BY sem`));
show('activity_log por dedupe prefix/semana', d1(`SELECT strftime('%Y-W%W',created_at) sem, substr(dedupe_key,1,7) pref, COUNT(*) n FROM activity_log WHERE created_at >= '${DESDE}' GROUP BY sem, pref ORDER BY sem`));
