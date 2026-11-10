/**
 * A minimal MCP server over stdio, used only by the probes (probes/index.mjs). It answers initialize / tools/list / tools/call and
 * appends one line per request to the file in FAKE_MCP_LOG, so the probe can tell whether a CLI loaded it.
 * One tool: speclock_ping, which returns PONG-<FAKE_MCP_TOKEN>.
 */

import { appendFileSync } from 'node:fs';

const LOG = process.env.FAKE_MCP_LOG;
const TOKEN = process.env.FAKE_MCP_TOKEN || 'none';
const note = (s) => LOG && appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`);

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

note(`spawned pid=${process.pid} cwd=${process.cwd()}`);

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    note(`<- ${msg.method ?? 'response'}`);
    if (msg.method === 'initialize') {
      send({ id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-speclock', version: '0.0.1' } } });
    } else if (msg.method === 'tools/list') {
      send({
        id: msg.id,
        result: { tools: [{ name: 'speclock_ping', description: 'Returns a fixed token. Call it when asked to ping speclock.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] },
      });
    } else if (msg.method === 'tools/call') {
      note(`tools/call ${msg.params?.name}`);
      send({ id: msg.id, result: { content: [{ type: 'text', text: `PONG-${TOKEN}` }] } });
    } else if (msg.id != null && msg.method) {
      send({ id: msg.id, result: {} });
    }
  }
});
process.stdin.on('end', () => {
  note('stdin closed');
  process.exit(0);
});
