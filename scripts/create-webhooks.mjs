#!/usr/bin/env node
// scripts/create-webhooks.mjs — registers Monday webhooks pointing at
// {BASE_URL}/api/sync/webhook/{WEBHOOK_TOKEN} for the 5 top-level boards.
//
// DO NOT RUN THIS AUTOMATICALLY — it creates real webhooks in the live Monday
// account. Run by hand, once, when BASE_URL (the deployed Worker) is known.
//
// Usage: node --env-file=.env scripts/create-webhooks.mjs <BASE_URL> <WEBHOOK_TOKEN>
import { BOARDS } from '../shared/boards.ts';
import { gql } from '../worker/lib/monday.ts';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
const [, , BASE_URL, WEBHOOK_TOKEN] = process.argv;
if (!MONDAY_API_KEY || !BASE_URL || !WEBHOOK_TOKEN) {
  console.error('Usage: node --env-file=.env scripts/create-webhooks.mjs <BASE_URL> <WEBHOOK_TOKEN>');
  process.exit(1);
}
const env = { MONDAY_API_KEY };
const callbackUrl = `${BASE_URL.replace(/\/$/, '')}/api/sync/webhook/${WEBHOOK_TOKEN}`;

const TOP_LEVEL = ['oportunidades', 'proyectos', 'productos', 'instituciones', 'contactos'];
const BASE_EVENTS = ['create_item', 'change_column_value', 'change_name', 'item_deleted'];
const SUBITEM_EVENTS = ['create_subitem', 'change_subitem_column_value', 'subitem_deleted'];
const hasSubitems = (slug) => Object.values(BOARDS).some(d => d.parent === slug);

const MUTATION = `mutation($board:ID!,$url:String!,$event:WebhookEventType!){
  create_webhook(board_id:$board, url:$url, event:$event){ id board_id }
}`;

async function main() {
  console.log(`Callback URL: ${callbackUrl}\n`);
  for (const slug of TOP_LEVEL) {
    const def = BOARDS[slug];
    const events = hasSubitems(slug) ? [...BASE_EVENTS, ...SUBITEM_EVENTS] : BASE_EVENTS;
    for (const event of events) {
      try {
        const data = await gql(env, MUTATION, { board: String(def.id), url: callbackUrl, event });
        console.log(`${slug} (${def.id}) <- ${event}: webhook id ${data.create_webhook.id}`);
      } catch (e) {
        console.error(`${slug} (${def.id}) <- ${event}: FAILED — ${e.message}`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
