// worker/lib/uxMetrics.ts — las 5 métricas de fricción, calculadas para poder
// COMPARARSE contra la línea base de Monday (138,794 eventos, mar–ago 2026).
// La comparabilidad es el único motivo por el que este archivo existe: no es un
// dashboard de analytics, es el otro lado de una tabla que ya está escrita.
//
// ────────────────────────────────────────────────────────────────────────────
// EL PROBLEMA QUE RESUELVE LA ATRIBUCIÓN (leer antes de tocar nada)
//
// El portal escribe a Monday. O sea que una edición hecha EN el portal viaja
// outbox → Monday → activity_logs → delta sync → tabla `activity_log`, y cae
// ahí IDÉNTICA a una hecha a mano en Monday.com: mismo user_id, mismo
// column_id, mismo shape. Sin separarlas, la métrica de re-edición sobre
// `activity_log` mide las dos herramientas juntas, y compararla contra el 73%
// de Monday sería comparar Monday contra (Monday + portal).
//
// La separación NO es heurística. `outbox` (worker/lib/outbox.ts) es un
// registro exacto de todo write originado en el portal —nunca se poda, tiene
// un solo escritor, y guarda board_id + item_id + cols + author_email +
// created_at—, así que cada fila de activity_log se etiqueta cruzando las
// CUATRO cosas: mismo board, mismo item, misma columna dentro del JSON de
// `cols`, y mismo autor (outbox.author_email → identity.monday_user_id →
// activity_log.user_id), dentro de la ventana en que el write pudo llegar a
// Monday. Lo que no casa es Monday nativo.
//
// El único falso positivo posible es que la MISMA persona edite la MISMA
// columna del MISMO item en las dos herramientas dentro de la ventana. Es raro,
// pero es exactamente el patrón de re-edición que se está midiendo, así que no
// se esconde: `atribucion.ambiguos` lo cuenta aparte para que el número se
// pueda descontar en vez de creerle a ciegas.
// ────────────────────────────────────────────────────────────────────────────
import type { Env } from '../env';
import { ensureUxTable } from './telemetry';

// Ventana en que un write del portal pudo aparecer en los activity_logs de
// Monday. Generosa hacia atrás porque flushOutbox reintenta; corta hacia
// adelante porque el tick de Monday es de cuando Monday lo registró.
const ATRIB_ANTES = '-15 minutes';
const ATRIB_DESPUES = '+2 minutes';

// ⚠ PARÁMETROS DE COMPARABILIDAD — tienen que ser LOS MISMOS con que se calculó
// la línea base de Monday en cmp-analisis. Cambiar uno aquí sin recalcular allá
// invalida la comparación de feb-2027 en silencio.
const REPEAT_WINDOW_S = 30;    // dos clics al mismo control dentro de esto = repetición
const REEDIT_CORTO_S = 60;     // "menos de 1 minuto" (14,883 pares en Monday)
const REEDIT_LARGO_S = 300;    // "menos de 5 minutos" (73% en Monday)

const MAX_ENDPOINTS = 50;

// SQLite devuelve `datetime(...)` con espacio y sin milisegundos, que NO compara
// lexicográficamente contra los ISO con 'T'/'Z' que guardan activity_log y
// outbox. strftime con este formato sí produce el mismo shape exacto.
const ISO = `'%Y-%m-%dT%H:%M:%fZ'`;

/** Etiqueta cada update_column_value de `activity_log` como 'portal' o 'monday'. */
const EDICIONES_CTE = `
  ediciones AS (
    SELECT a.item_id, a.column_id, a.user_id, a.created_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM outbox o
        JOIN identity i ON i.email = o.author_email
        WHERE o.board_id = a.board_id AND o.item_id = a.item_id
          AND i.monday_user_id = a.user_id
          AND o.cols LIKE '%"' || a.column_id || '"%'
          AND o.created_at >= strftime(${ISO}, a.created_at, '${ATRIB_ANTES}')
          AND o.created_at <= strftime(${ISO}, a.created_at, '${ATRIB_DESPUES}')
      ) THEN 'portal' ELSE 'monday' END AS origen
    FROM activity_log a
    WHERE a.event = 'update_column_value'
      AND a.column_id IS NOT NULL AND a.user_id IS NOT NULL
      AND a.created_at >= ? AND a.created_at < ?
  )`;

export interface ReEdicionStats {
  pares: number; menosDe1Min: number; menosDe5Min: number; pctMenosDe5Min: number;
}
export interface UxReport {
  desde: string; hasta: string;
  parametros: { repeatWindowS: number; reeditCortoS: number; reeditLargoS: number };
  atribucion: { ediciones: number; portal: number; monday: number; ambiguos: number };
  clicSinAcuse: {
    clics: number; repeticiones: number;
    sinNingunaSenal: number; respondioYNoEspero: number;
    pctSinSenal: number | null; pctNoEspero: number | null;
  };
  reEdicion: { portal: ReEdicionStats; monday: ReEdicionStats };
  tiempoPorTarea: { n: number; p50Seg: number | null; p90Seg: number | null };
  adopcionSemanal: { semana: string; portal: number; monday: number }[];
  latencia: { target: string; n: number; p50Ms: number | null; p90Ms: number | null }[];
}

const pct = (parte: number, total: number): number | null =>
  total > 0 ? Math.round((parte / total) * 1000) / 10 : null;

function stats(row: { pares: number; m1: number; m5: number } | undefined): ReEdicionStats {
  const pares = row?.pares ?? 0;
  return {
    pares,
    menosDe1Min: row?.m1 ?? 0,
    menosDe5Min: row?.m5 ?? 0,
    pctMenosDe5Min: pct(row?.m5 ?? 0, pares) ?? 0,
  };
}


// Las consultas se exportan como constantes (en vez de vivir inline) para poder
// correrlas TAL CUAL contra sqlite en worker/lib/uxMetrics.test.ts. No es
// cosmético: la clasificación del clic-sin-acuse ya tenía un bug de ventana que
// el typecheck no podía ver y que solo salió al ejecutarla con datos reales.

export const Q_ATRIBUCION = `
    WITH ${EDICIONES_CTE}
    SELECT COUNT(*) AS ediciones,
           SUM(CASE WHEN origen = 'portal' THEN 1 ELSE 0 END) AS portal,
           SUM(CASE WHEN origen = 'monday' THEN 1 ELSE 0 END) AS monday
    FROM ediciones`;

export const Q_AMBIGUOS = `
    WITH ${EDICIONES_CTE}
    SELECT COUNT(*) AS n FROM (
      SELECT item_id, column_id, user_id FROM ediciones
      GROUP BY item_id, column_id, user_id
      HAVING COUNT(DISTINCT origen) > 1
    )`;

export const Q_CLIC_SIN_ACUSE = `
    WITH c AS (
      SELECT e.id, e.session_id, e.target, COALESCE(e.item_id, -1) AS item, e.created_at,
             (SELECT MIN(a.created_at) FROM ux_event a
               WHERE a.corr = e.corr AND a.kind IN ('ack','error')) AS ack_at
      FROM ux_event e
      WHERE e.kind = 'click' AND e.created_at >= ? AND e.created_at < ?
    ),
    r AS (
      SELECT c.*,
        LAG(c.created_at) OVER (PARTITION BY c.session_id, c.target, c.item ORDER BY c.created_at) AS prev_click,
        -- El acuse MÁS TEMPRANO de CUALQUIER clic anterior al mismo control, no
        -- el del clic inmediatamente previo: la pregunta es "¿el sistema ya
        -- había dado alguna señal?", igual que en la línea base de Monday. Con
        -- LAG simple, un tercer clic quedaba como "sin ninguna señal" aunque el
        -- acuse del primero ya hubiera llegado — inflaba el 58% contra el 42%.
        MIN(c.ack_at) OVER (PARTITION BY c.session_id, c.target, c.item ORDER BY c.created_at
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS senal_previa
      FROM c
    )
    SELECT
      (SELECT COUNT(*) FROM c) AS clics,
      SUM(CASE WHEN es_repe THEN 1 ELSE 0 END) AS repeticiones,
      -- Al momento del segundo clic, ¿ya había llegado alguna señal del primero?
      SUM(CASE WHEN es_repe AND (senal_previa IS NULL OR senal_previa > created_at) THEN 1 ELSE 0 END) AS sin_senal,
      SUM(CASE WHEN es_repe AND senal_previa IS NOT NULL AND senal_previa <= created_at THEN 1 ELSE 0 END) AS no_espero
    FROM (
      SELECT *, (prev_click IS NOT NULL
                 AND (julianday(created_at) - julianday(prev_click)) * 86400.0 < ${REPEAT_WINDOW_S}) AS es_repe
      FROM r
    )`;

export const Q_REEDICION = `
    WITH ${EDICIONES_CTE},
    pares AS (
      SELECT origen,
        (julianday(created_at) - julianday(
          LAG(created_at) OVER (PARTITION BY item_id, column_id, user_id, origen ORDER BY created_at)
        )) * 86400.0 AS delta_s
      FROM ediciones
    )
    SELECT origen, COUNT(*) AS pares,
      SUM(CASE WHEN delta_s < ${REEDIT_CORTO_S} THEN 1 ELSE 0 END) AS m1,
      SUM(CASE WHEN delta_s < ${REEDIT_LARGO_S} THEN 1 ELSE 0 END) AS m5
    FROM pares WHERE delta_s IS NOT NULL GROUP BY origen`;

export const Q_TIEMPO_TAREA = `
    WITH t AS (
      SELECT (julianday(
                (SELECT MIN(ed.created_at) FROM ux_event ed
                  WHERE ed.kind = 'edit' AND ed.session_id = n.session_id
                    AND ed.item_id = n.item_id AND ed.created_at > n.created_at)
              ) - julianday(n.created_at)) * 86400.0 AS seg
      FROM ux_event n
      WHERE n.kind = 'nav' AND n.target = 'drawer:open'
        AND n.item_id IS NOT NULL AND n.created_at >= ? AND n.created_at < ?
    ),
    ranked AS (
      SELECT seg, ROW_NUMBER() OVER (ORDER BY seg) AS rn, COUNT(*) OVER () AS cnt
      FROM t WHERE seg IS NOT NULL
    )
    SELECT cnt AS n,
      MAX(CASE WHEN rn = max(1, CAST(cnt * 0.5 AS INTEGER)) THEN seg END) AS p50,
      MAX(CASE WHEN rn = max(1, CAST(cnt * 0.9 AS INTEGER)) THEN seg END) AS p90
    FROM ranked GROUP BY cnt`;

export const Q_ADOPCION = `
    WITH ${EDICIONES_CTE}
    SELECT strftime('%Y-W%W', created_at) AS semana,
      COUNT(DISTINCT CASE WHEN origen = 'portal' THEN user_id END) AS portal,
      COUNT(DISTINCT CASE WHEN origen = 'monday' THEN user_id END) AS monday
    FROM ediciones GROUP BY semana ORDER BY semana`;

export const Q_LATENCIA = `
    WITH ranked AS (
      SELECT target, latency_ms,
        ROW_NUMBER() OVER (PARTITION BY target ORDER BY latency_ms) AS rn,
        COUNT(*)     OVER (PARTITION BY target) AS cnt
      FROM ux_event
      WHERE kind = 'ack' AND latency_ms IS NOT NULL
        AND created_at >= ? AND created_at < ?
    )
    SELECT target, cnt AS n,
      MAX(CASE WHEN rn = max(1, CAST(cnt * 0.5 AS INTEGER)) THEN latency_ms END) AS p50,
      MAX(CASE WHEN rn = max(1, CAST(cnt * 0.9 AS INTEGER)) THEN latency_ms END) AS p90
    FROM ranked GROUP BY target, cnt ORDER BY cnt DESC LIMIT ${MAX_ENDPOINTS}`;

export async function buildUxReport(env: Env, desde: string, hasta: string): Promise<UxReport> {
  // `ux_event` se crea lazy en la ingesta: en un despliegue nuevo el reporte
  // puede correr antes del primer evento y las consultas de abajo tronarían.
  await ensureUxTable(env);

  // ── 1. Atribución: cuántas ediciones son del portal y cuántas de Monday ──
  const atribucion = await env.DB.prepare(Q_ATRIBUCION).bind(desde, hasta).first<{ ediciones: number; portal: number; monday: number }>();

  // Falso positivo posible de la atribución (ver cabecera): la misma persona
  // tocó la misma celda en las dos herramientas dentro de la ventana.
  const ambiguos = await env.DB.prepare(Q_AMBIGUOS).bind(desde, hasta).first<{ n: number }>();

  // ── 2. Clic sin acuse (Monday: 58% sin ninguna señal / 42% no esperó) ──
  // El acuse se empareja por `corr`, no por "el clic más cercano anterior":
  // esa heurística se vuelve ambigua justo cuando hay dos clics seguidos, que
  // es el caso que la métrica existe para medir.
  const clics = await env.DB.prepare(Q_CLIC_SIN_ACUSE).bind(desde, hasta).first<{ clics: number; repeticiones: number; sin_senal: number; no_espero: number }>();

  // ── 3. Re-edición rápida sobre la misma celda (Monday: 73% < 5 min) ──
  // Se particiona TAMBIÉN por origen: pares portal contra pares portal, pares
  // Monday contra pares Monday. Mezclarlos volvería a juntar las dos
  // herramientas, que es justo lo que la atribución vino a separar.
  const reedit = await env.DB.prepare(Q_REEDICION).bind(desde, hasta).all<{ origen: string; pares: number; m1: number; m5: number }>();

  // ── 4. Tiempo por tarea: abrir el drawer → primer guardado ──
  const tarea = await env.DB.prepare(Q_TIEMPO_TAREA).bind(desde, hasta).first<{ n: number; p50: number | null; p90: number | null }>();

  // ── 5. Adopción semanal: personas distintas con al menos UNA EDICIÓN ──
  // Ediciones, no "algún evento": la línea base de Monday son cambios, no
  // visitas. Contar navegación aquí inflaría al portal contra Monday.
  const adopcion = await env.DB.prepare(Q_ADOPCION).bind(desde, hasta).all<{ semana: string; portal: number; monday: number }>();

  // ── 6. Latencia real por endpoint (p50/p90) — no existía ninguna medición ──
  const latencia = await env.DB.prepare(Q_LATENCIA).bind(desde, hasta).all<{ target: string; n: number; p50: number | null; p90: number | null }>();

  const porOrigen = new Map((reedit.results ?? []).map(r => [r.origen, r]));
  const repeticiones = clics?.repeticiones ?? 0;

  return {
    desde, hasta,
    parametros: { repeatWindowS: REPEAT_WINDOW_S, reeditCortoS: REEDIT_CORTO_S, reeditLargoS: REEDIT_LARGO_S },
    atribucion: {
      ediciones: atribucion?.ediciones ?? 0,
      portal: atribucion?.portal ?? 0,
      monday: atribucion?.monday ?? 0,
      ambiguos: ambiguos?.n ?? 0,
    },
    clicSinAcuse: {
      clics: clics?.clics ?? 0,
      repeticiones,
      sinNingunaSenal: clics?.sin_senal ?? 0,
      respondioYNoEspero: clics?.no_espero ?? 0,
      pctSinSenal: pct(clics?.sin_senal ?? 0, repeticiones),
      pctNoEspero: pct(clics?.no_espero ?? 0, repeticiones),
    },
    reEdicion: { portal: stats(porOrigen.get('portal')), monday: stats(porOrigen.get('monday')) },
    tiempoPorTarea: {
      n: tarea?.n ?? 0,
      p50Seg: tarea?.p50 != null ? Math.round(tarea.p50) : null,
      p90Seg: tarea?.p90 != null ? Math.round(tarea.p90) : null,
    },
    adopcionSemanal: adopcion.results ?? [],
    latencia: (latencia.results ?? []).map(r => ({
      target: r.target, n: r.n, p50Ms: r.p50, p90Ms: r.p90,
    })),
  };
}
