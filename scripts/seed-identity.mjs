#!/usr/bin/env node
// scripts/seed-identity.mjs — seeds D1 `identity` from Monday's non-guest users.
// Usage: node --env-file=.env scripts/seed-identity.mjs [--exec]
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gql } from '../worker/lib/monday.ts';

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
if (!MONDAY_API_KEY) {
  console.error('MONDAY_API_KEY missing — run with: node --env-file=.env scripts/seed-identity.mjs');
  process.exit(1);
}
const env = { MONDAY_API_KEY };
const EXEC = process.argv.includes('--exec');

const ADMIN_EMAILS = ['salinasefrain@mexicanadeproteccion.com', 'efrain.ponces@gmail.com'];
const sqlEscape = (s) => String(s).replace(/'/g, "''");

function buildInsert({ email, phone, nombre, monday_user_id, role }) {
  const vals = [
    `'${sqlEscape(email)}'`,
    phone ? `'${sqlEscape(phone)}'` : 'NULL',
    nombre ? `'${sqlEscape(nombre)}'` : 'NULL',
    monday_user_id,
    `'${role}'`,
    1,
  ];
  return `INSERT OR REPLACE INTO identity (email,phone,nombre,monday_user_id,role,active) VALUES (${vals.join(',')});`;
}

async function main() {
  const data = await gql(env, `query{ users(kind:non_guests, limit:200){ id name email } }`);
  const users = data.users ?? [];
  console.log(`Fetched ${users.length} non-guest Monday users`);

  const byEmail = new Map(users.map(u => [u.email?.toLowerCase(), u]));
  const rows = [];

  for (const email of ADMIN_EMAILS) {
    const u = byEmail.get(email.toLowerCase());
    if (u) {
      rows.push({ email, nombre: u.name, monday_user_id: Number(u.id), role: 'admin' });
    } else {
      // Fall back to a Monday user named like "Efra" if the admin email itself
      // isn't a Monday login; else insert with monday_user_id 0 (unmapped).
      const guess = users.find(x => /efra/i.test(x.name ?? ''));
      rows.push({
        email, nombre: guess?.name ?? email, role: 'admin',
        monday_user_id: guess ? Number(guess.id) : 0,
      });
      console.warn(`WARNING: admin email ${email} not found among Monday users` +
        (guess ? ` — using "${guess.name}" (${guess.id}) as monday_user_id` : ' — monday_user_id set to 0'));
    }
  }

  const adminEmailSet = new Set(ADMIN_EMAILS.map(e => e.toLowerCase()));
  for (const u of users) {
    if (!u.email || adminEmailSet.has(u.email.toLowerCase())) continue;
    rows.push({ email: u.email, nombre: u.name, monday_user_id: Number(u.id), role: 'vendedor' });
  }

  const sql = rows.map(buildInsert).join('\n') + '\n';
  const outDir = fileURLToPath(new URL('../.wrangler/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}seed-identity.sql`;
  writeFileSync(outPath, sql);
  console.log(`Wrote ${rows.length} identity rows to ${outPath}`);

  if (EXEC) {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'cmp-portal', '--local', `--file=${outPath}`, '--env-file=/dev/null'], { stdio: 'inherit' });
    console.log('Done.');
  } else {
    console.log(`Run with:\n  npx wrangler d1 execute cmp-portal --local --file=${outPath} --env-file=/dev/null`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
