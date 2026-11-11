/**
 * Every driver keeps the contract in index.mjs, and what they hand to the CLIs is what the scaffold always handed them.
 * No process, no model, nothing installed needed.
 */

import { dshFolderName, driverTypes, drivers, getDriver, piMcpServers, wantedPackages } from '../index.mjs';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || !extra ? '' : `  (${extra})`}`);
  if (!ok) failed++;
};

console.log('\n=== drivers ===\n');

// An install with every package present, and one with nothing.
const full = { node: 'N:/node.exe', dir: (n) => `P:/modules/${n}`, version: () => '1.0.0' };
const empty = { node: 'N:/node.exe', dir: () => null, version: () => null };
const ctx = { agentdRoot: 'A:/agentd' };

check('the six CLIs have a driver', driverTypes.join() === 'mcode,dsh,opencode,claude,codex,pi', driverTypes.join());

for (const d of Object.values(drivers)) {
  const ok =
    typeof d.label === 'string' &&
    typeof d.description === 'string' &&
    Array.isArray(d.packages) && d.packages.length > 0 && d.packages.every((p) => p.name && /^\d+\.\d+\.\d+/.test(p.version)) &&
    d.verified?.on && d.verified?.note &&
    d.capabilities && 'compact' in d.capabilities && d.capabilities.rules && d.capabilities.mcp &&
    typeof d.launch === 'function' && typeof d.rules === 'function';
  check(`${d.type}: follows the contract`, Boolean(ok));
  const l = d.launch(full, ctx);
  check(`${d.type}: launch gives cmd, args and env, and nothing is missing when everything is installed`, Boolean(l.cmd) && Array.isArray(l.args) && typeof l.env === 'object' && l.missing.length === 0, JSON.stringify(l));
  const m = d.launch(empty, ctx);
  check(`${d.type}: launch does not throw when nothing is installed, and names what is missing`, m.missing.length >= 1 && m.missing.every((n) => d.packages.some((p) => p.name === n)), JSON.stringify(m.missing));
  const r = d.rules({ text: 'RULES', file: 'R:/rules.md', env: {} });
  check(`${d.type}: rules() returns args, env, meta and prefix`, Array.isArray(r.args) && typeof r.env === 'object' && 'meta' in r && typeof r.prefix === 'boolean');
  const nofile = d.rules({ text: 'RULES', file: null, env: {} });
  check(`${d.type}: a rules file that could not be written falls back to the prompt or the text itself`, nofile.prefix === true || nofile.meta != null);
}

// How each CLI is started: the same command lines as before the drivers existed.
const L = (t) => getDriver(t).launch(full, ctx);
check('mcode: node cli.js acp', L('mcode').cmd === 'N:/node.exe' && L('mcode').args.join(' ') === 'P:/modules/@minimax-ai/code/cli.js acp');
check('dsh: node bin.js --profile acp', L('dsh').args.join(' ') === 'P:/modules/@deepseek-ai/dsh/lib/bin.js --profile acp');
check('opencode: its own executable, acp', /^P:\/modules\/opencode-ai\/bin\/opencode(\.exe)?$/.test(L('opencode').cmd) && L('opencode').args.join() === 'acp');
check('claude: the adapter, with the installed Claude Code as the executable', L('claude').args[0] === 'P:/modules/@agentclientprotocol/claude-agent-acp/dist/index.js' && /claude-code\/bin\/claude(\.exe)?$/.test(L('claude').env.CLAUDE_CODE_EXECUTABLE));
check('codex: the adapter', L('codex').args[0] === 'P:/modules/@agentclientprotocol/codex-acp/dist/index.js');
check('pi: the scaffold adapter, told where pi is', /agentd[\\/]server[\\/]pi-acp-adapter\.mjs$/.test(L('pi').args[0]) && L('pi').env.PI_CLI === 'P:/modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js' && L('pi').env.PI_NODE_BIN === 'N:/node.exe');
check('pi: paths() gives its cli.js for the dispatcher', getDriver('pi').paths(full).cli.endsWith('pi-coding-agent/dist/bundle/cli.js'));

// How each is handed the rules: as before.
const R = (t, env = {}) => getDriver(t).rules({ text: 'RULES', file: 'R:/rules.md', env });
check('mcode: a flag with the file', R('mcode').args.join() === '--append-system-prompt-file,R:/rules.md');
check('pi: an environment variable with the file', R('pi').env.AGENTD_APPEND_SYSTEM_PROMPT_FILE === 'R:/rules.md');
check('claude: _meta.systemPrompt.append', R('claude').meta.systemPrompt.append === 'RULES');
check('codex: _meta.jetbrains.air.customInstructions', R('codex').meta.jetbrains.air.customInstructions === 'RULES');
check('opencode: OPENCODE_CONFIG_CONTENT.instructions', JSON.parse(R('opencode').env.OPENCODE_CONFIG_CONTENT).instructions.join() === 'R:/rules.md');
check('opencode: keeps what the user already passes that way', (() => {
  const c = JSON.parse(R('opencode', { OPENCODE_CONFIG_CONTENT: '{"model":"x","instructions":["a.md"]}' }).env.OPENCODE_CONFIG_CONTENT);
  return c.model === 'x' && c.instructions.join() === 'a.md,R:/rules.md';
})());
check('dsh: no channel, the text goes in front of the first prompt', R('dsh').prefix === true && R('dsh').args.length === 0);

// What the rest of the scaffold may rely on.
check('compaction: every CLI but dsh has /compact', driverTypes.every((t) => (getDriver(t).capabilities.compact === '/compact') === (t !== 'dsh')));
check('mcp: pi takes servers from the environment, the others in the session request', driverTypes.every((t) => getDriver(t).capabilities.mcp === (t === 'pi' ? 'env' : 'acp')));
check('only dsh lists its sessions from disk', driverTypes.every((t) => Boolean(getDriver(t).capabilities.sessionsOnDisk) === (t === 'dsh') && (typeof getDriver(t).diskSessions === 'function') === (t === 'dsh')));

// pi's own pieces
check('pi: the session folder is per instance', getDriver('pi').instanceEnv({ id: 'p~x', conversationsDir: 'C:/c' }).PI_SESSION_DIR === 'C:/c/pi-sessions/p~x' || getDriver('pi').instanceEnv({ id: 'p~x', conversationsDir: 'C:/c' }).PI_SESSION_DIR.endsWith('pi-sessions\\p~x'));
const none = getDriver('pi').spawnEnv({ cwd: 'W:/w', mcpServers: [] });
check('pi: no servers means an empty variable, so an inherited one cannot leak in', none.AGENTD_MCP_SERVERS === '' && none.AGENTD_BASE_CWD === 'W:/w');
const stdio = { name: 's', command: 'speclock', args: ['mcp'], env: [{ name: 'K', value: 'v' }] };
const withServers = getDriver('pi').spawnEnv({ cwd: null, mcpServers: [stdio, { type: 'http', name: 'h', url: 'https://e.com/mcp', headers: [{ name: 'A', value: 'b' }] }] });
const parsed = JSON.parse(withServers.AGENTD_MCP_SERVERS);
check('pi: servers become mcp.json entries', parsed.s.command === 'speclock' && parsed.s.env.K === 'v' && parsed.h.url === 'https://e.com/mcp' && parsed.h.headers.A === 'b' && !('AGENTD_BASE_CWD' in withServers));
check('pi: piMcpServers is the same conversion', JSON.stringify(piMcpServers([stdio]).s.args) === '["mcp"]');

// dsh's folder naming (a private format, so it is pinned here)
check('dsh: folder name for a Windows path', dshFolderName('D:\\a\\b') === '--D-a-b--', dshFolderName('D:\\a\\b'));
check('dsh: non-ASCII becomes ~UTF16HEX', dshFolderName('D:\\a\\研究') === '--D-a-~7814~7A76--', dshFolderName('D:\\a\\研究'));

// providers: another endpoint and key
const P = { id: 'mm', apiKey: 'sk-test-0123456789', models: ['m1', 'm2'] };
const applied = Object.fromEntries(driverTypes.map((t) => [t, getDriver(t).provider.apply({ provider: P, endpoint: 'https://e.example/x', model: 'm1', dir: 'C:/cfg', env: {} })]));
check('providers: every CLI says which protocol it speaks and where the provider lives', driverTypes.every((t) => ['anthropic', 'openai'].includes(getDriver(t).provider.protocol) && ['process', 'global'].includes(getDriver(t).provider.scope)));
check('providers: only mcode keeps them in its own configuration', driverTypes.every((t) => (getDriver(t).provider.scope === 'global') === (t === 'mcode')));
check('providers: only claude and mcode speak the Anthropic protocol', driverTypes.every((t) => (getDriver(t).provider.protocol === 'anthropic') === (t === 'claude' || t === 'mcode')));
check('providers: apply gives env, args and files, and the key is in the environment', driverTypes.every((t) => applied[t].env && Array.isArray(applied[t].args) && Array.isArray(applied[t].files) && Object.values(applied[t].env).some((v) => String(v).includes(P.apiKey))));
check('providers: no file written for a CLI carries the key', driverTypes.every((t) => applied[t].files.every((f) => !f.content.includes(P.apiKey))));
check('providers: claude points every model alias at the model', applied.claude.env.ANTHROPIC_BASE_URL === 'https://e.example/x' && applied.claude.env.ANTHROPIC_DEFAULT_OPUS_MODEL === 'm1');
check('providers: codex names the provider and the Responses protocol', JSON.parse(applied.codex.env.CODEX_CONFIG).model_providers.mm.wire_api === 'responses' && applied.codex.env.MODEL_PROVIDER === 'mm');
const ocBase = JSON.stringify({ instructions: ['rules.md'] });
const oc = JSON.parse(getDriver('opencode').provider.apply({ provider: P, endpoint: 'https://e.example/x', model: 'm1', dir: 'C:/cfg', env: { OPENCODE_CONFIG_CONTENT: ocBase } }).env.OPENCODE_CONFIG_CONTENT);
check('providers: opencode keeps the rules already in its configuration', oc.instructions[0] === 'rules.md' && oc.model === 'mm/m1' && oc.provider.mm.options.baseURL === 'https://e.example/x' && Object.keys(oc.provider.mm.models).join() === 'm1,m2');
check('providers: dsh gets a patch file and selects the model through its option value', applied.dsh.args.join(' ') === '--patch C:/cfg/dsh-patch.yml' && applied.dsh.files[0].name === 'dsh-patch.yml' && applied.dsh.model === '["mm","m1"]');
check('providers: pi gets a folder of its own, the key only by name', applied.pi.env.PI_CODING_AGENT_DIR === 'C:/cfg' && JSON.parse(applied.pi.files[0].content).providers.mm.apiKey === '$SCAFFOLD_PROVIDER_KEY');
check('providers: mcode gives the commands to add and remove it, under its own prefix', applied.mcode.global.add.includes('speclock-mm') && applied.mcode.global.remove.includes('custom_provider:speclock-mm'));

// the packages the preflight has to find
const wanted = wantedPackages();
check('each npm package is listed once, with the CLIs that use it', new Set(wanted.map((p) => p.name)).size === wanted.length && wanted.some((p) => p.name === '@anthropic-ai/claude-code' && p.types.join() === 'claude'));
check('seven packages in all', wanted.length === 7, String(wanted.length));

console.log(failed ? `\n=> ✗ ${failed} FAILED` : '\n=> ✓ DRIVERS OK');
process.exit(failed ? 1 : 0);
