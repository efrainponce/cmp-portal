// Interactive REPL against the WhatsApp bot's dev endpoint — chat with the agent
// from the terminal without WhatsApp. Requires `npx wrangler dev --env-file=.dev.vars`
// running and ANTHROPIC_API_KEY set in .dev.vars (or the mock, see wa-mock-anthropic.mjs).
//
//   node scripts/wa-chat.mjs [phone] [port]
//
// The phone must exist in the local D1 `identity` table (default: 5214770000001,
// seeded on efrain.ponces@gmail.com for local testing).
import readline from 'node:readline';

const phone = process.argv[2] ?? '5214770000001';
const port = process.argv[3] ?? '8787';
const url = `http://localhost:${port}/wa/dev-chat`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`Chateando como ${phone} contra ${url} — escribe "salir" para terminar.\n`);

const ask = () => rl.question('tú> ', async (text) => {
  if (text.trim().toLowerCase() === 'salir') { rl.close(); return; }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, text }),
    });
    const json = await res.json();
    console.log(`\nbot> ${json.reply ?? JSON.stringify(json)}\n`);
  } catch (err) {
    console.error('error:', err.message);
  }
  ask();
});
ask();
