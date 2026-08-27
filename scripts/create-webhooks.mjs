#!/usr/bin/env node
// scripts/create-webhooks.mjs — registers Monday webhooks pointing at
// {BASE_URL}/api/sync/webhook/{WEBHOOK_TOKEN} for the 5 top-level boards.
//
// DO NOT RUN THIS AUTOMATICALLY — it creates real webhooks in the live Monday
// account. Run by hand, once, when BASE_URL (the deployed Worker) is known.
//
// Usage: node --env-file=.env scripts/create-webhooks.mjs <BASE_URL> <WEBHOOK_TOKEN>
//        [--events=create_update] [--boards=oportunidades,proyectos]
//        [--column=deal_stage]   (obliga a --events=change_specific_column_value)
//
// Sin flags registra TODOS los eventos en TODOS los boards de primer nivel — eso
// DUPLICA los que ya existen (Monday no de-duplica). Para agregar un evento nuevo
// a una cuenta que ya tiene webhooks, usa --events/--boards y registra solo eso.
import { BOARDS } from '../shared/boards.ts';
import { gql } from '../worker/lib/monday.ts';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '').split('=')));
const [BASE_URL, WEBHOOK_TOKEN] = argv.filter(a => !a.startsWith('--'));
if (!MONDAY_API_KEY || !BASE_URL || !WEBHOOK_TOKEN) {
  console.error('Usage: node --env-file=.env scripts/create-webhooks.mjs <BASE_URL> <WEBHOOK_TOKEN>');
  process.exit(1);
}
const env = { MONDAY_API_KEY };
const callbackUrl = `${BASE_URL.replace(/\/$/, '')}/api/sync/webhook/${WEBHOOK_TOKEN}`;

const TOP_LEVEL = ['oportunidades', 'proyectos', 'productos', 'instituciones', 'contactos'];
// 2026-07-31: change_column_value / change_subitem_column_value (cualquier
// columna) se quitaron — consumían ~80% de la cuota de acciones de Monday con
// webhooks que ni el propio portal necesita (cada mutación disparada por el
// portal ya se refetchea sola vía refetchItem/refetchItemTree). Sin ellos, el
// mirror depende de `?fresh=1` al abrir el drawer + reconcileAll (cron 6h)
// para detectar ediciones hechas directo en Monday.
// create_update (2026-08-18): comentarios escritos DENTRO de monday.com — sin este
// evento el portal nunca se enteraba de ellos y su centro de notificaciones solo
// mostraba cambios de etapa (worker/lib/updateNotify.ts).
//
// deal_stage (2026-08-27): NO va en BASE_EVENTS — se registra a mano y aparte con
//   --boards=oportunidades --events=change_specific_column_value --column=deal_stage
// Es `change_specific_column_value`, no el `change_column_value` genérico que se
// quitó en julio: dispara SOLO al mover la etapa (una fracción de los ~57 eventos
// diarios del board), no en cada tecla, así que el costo de cuota es mínimo. Vale
// la pena porque la etapa es lo que mete o saca una oportunidad de la lista de
// compras, y un cambio hecho dentro de Monday tardaba hasta 30 min en verse.
// OJO: en el board ya existe un webhook de deal_stage que NO es nuestro (es de
// Make, id 531643702) — no confundirlos ni borrar el ajeno.
const BASE_EVENTS = ['create_item', 'change_name', 'item_deleted', 'create_update'];
const SUBITEM_EVENTS = ['create_subitem', 'subitem_deleted'];
const hasSubitems = (slug) => Object.values(BOARDS).some(d => d.parent === slug);

const MUTATION = `mutation($board:ID!,$url:String!,$event:WebhookEventType!,$config:JSON){
  create_webhook(board_id:$board, url:$url, event:$event, config:$config){ id board_id }
}`;

const onlyEvents = flags.events ? flags.events.split(',') : null;
if (flags.column && !(onlyEvents ?? []).includes('change_specific_column_value')) {
  console.error('--column exige --events=change_specific_column_value');
  process.exit(1);
}
const onlyBoards = flags.boards ? flags.boards.split(',') : null;

async function main() {
  console.log(`Callback URL: ${callbackUrl}\n`);
  for (const slug of TOP_LEVEL) {
    if (onlyBoards && !onlyBoards.includes(slug)) continue;
    const def = BOARDS[slug];
    const all = hasSubitems(slug) ? [...BASE_EVENTS, ...SUBITEM_EVENTS] : BASE_EVENTS;
    // Con --events explícito se registra lo que se pidió, esté o no en las
    // listas de arriba (así entra change_specific_column_value, que a propósito
    // no vive en BASE_EVENTS para que una corrida sin flags no lo duplique).
    const events = onlyEvents ?? all;
    for (const event of events) {
      // `config` solo aplica a change_specific_column_value; en cualquier otro
      // evento Monday lo rechaza, por eso va condicionado a --column.
      const config = flags.column ? JSON.stringify({ columnId: flags.column }) : null;
      try {
        const data = await gql(env, MUTATION, { board: String(def.id), url: callbackUrl, event, config });
        console.log(`${slug} (${def.id}) <- ${event}${flags.column ? ` [${flags.column}]` : ''}: webhook id ${data.create_webhook.id}`);
      } catch (e) {
        console.error(`${slug} (${def.id}) <- ${event}: FAILED — ${e.message}`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
