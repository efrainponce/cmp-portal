// Mock Anthropic Messages API for local testing of the WhatsApp agent loop.
// Drives deterministic tool calls from magic prefixes in the user message, so the
// worker-side loop (tools, D1 searches, Monday creates, persistence) can be
// exercised without a real model. Usage: node scripts/wa-mock-anthropic.mjs
import http from 'node:http';

function respond(res, content, stopReason) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-haiku-4-5',
    content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const messages = body.messages ?? [];
    const last = messages[messages.length - 1] ?? {};

    // Tool results came back → echo them as final text so the test can inspect them.
    if (Array.isArray(last.content) && last.content.some(b => b.type === 'tool_result')) {
      const tr = last.content.find(b => b.type === 'tool_result');
      const text = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
      return respond(res, [{ type: 'text', text: `TOOL_RESULT>>>${text}` }], 'end_turn');
    }

    const text = typeof last.content === 'string' ? last.content : '';
    const tool = (name, input) =>
      respond(res, [{ type: 'tool_use', id: `toolu_mock_${Date.now()}`, name, input }], 'tool_use');

    if (text.startsWith('busca producto ')) return tool('buscar_productos', { q: text.slice(15) });
    if (text.startsWith('busca contacto ')) return tool('buscar_contactos', { q: text.slice(15) });
    if (text.startsWith('busca institucion ')) return tool('buscar_instituciones', { q: text.slice(18) });
    if (text.startsWith('CREAOP ')) return tool('crear_oportunidad', JSON.parse(text.slice(7)));
    if (text.startsWith('CREACONTACTO ')) return tool('crear_contacto', JSON.parse(text.slice(13)));
    return respond(res, [{ type: 'text', text: `MOCK_OK (history=${messages.length})` }], 'end_turn');
  });
});

server.listen(8788, '127.0.0.1', () => console.log('mock anthropic on http://127.0.0.1:8788'));
