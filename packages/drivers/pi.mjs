/**
 * A separate pi instance. pi has no ACP of its own; the scaffold ships an adapter (agentd's pi-adapter/acp-adapter.mjs)
 * that turns ACP into pi's RPC mode, and this driver starts that adapter.
 *
 *   rules   --append-system-prompt <file>, added by the adapter to pi's command line (env AGENTD_APPEND_SYSTEM_PROMPT_FILE)
 *   mcp     not in the session requests: servers go in AGENTD_MCP_SERVERS (pi's own mcp.json shape) and the adapter loads
 *           them through pi's built-in MCP client and a small extension (agentd's pi-adapter/mcp-bridge.ts)
 *   compact /compact, which the adapter turns into pi's own compact command
 *
 * Besides the adapter there is pi itself (@earendil-works/pi-coding-agent): the adapter and the project dispatcher both
 * start its cli.js, which `paths()` gives.
 */

import { join } from 'node:path';
import { NO_RULES, RULES_IN_PROMPT, packageDir } from './lib.mjs';
import { reasoningFor } from './pi-catalog.mjs';

const PKG = '@earendil-works/pi-coding-agent';

/** ACP's `mcpServers` list in the shape of pi's mcp.json entries. */
export function piMcpServers(list = []) {
  const toObj = (arr) => Object.fromEntries((arr ?? []).map((p) => [p.name, p.value]));
  return Object.fromEntries(
    list.map((s) => [
      s.name,
      s.type === 'http' ? { url: s.url, headers: toObj(s.headers) } : { command: s.command, args: s.args ?? [], env: toObj(s.env) },
    ]),
  );
}

export default {
  type: 'pi',
  label: 'Pi',
  description:
    'A separate pi instance, exposed through an ACP adapter over pi RPC mode. ' +
    'Runs with --no-mcp so it cannot call back into this server.',

  packages: [{ name: PKG, version: '1.3.0' }],
  verified: { on: '2026-11-10', note: 'rpc mode, -e builtin:mcp with registerMcpServer, rules and /compact checked on 1.3.0' },
  capabilities: { compact: '/compact', rules: 'env', mcp: 'env', mcpStart: 'eager' },

  /** `ctx.agentdRoot` is packages/agentd: the adapter is part of it. */
  launch(install, ctx) {
    const missing = [];
    const dir = packageDir(install, PKG, missing);
    return {
      cmd: install.node,
      args: [join(ctx.agentdRoot, 'pi-adapter', 'acp-adapter.mjs')],
      env: { PI_CLI: `${dir}/dist/bundle/cli.js`, PI_NODE_BIN: install.node },
      missing,
    };
  },

  /** Where pi itself is, for whoever starts it directly (the project dispatcher). */
  paths(install) {
    const missing = [];
    const dir = packageDir(install, PKG, missing);
    return { cli: `${dir}/dist/bundle/cli.js`, missing };
  },

  /** Fixed for the instance. The adapter keeps its session map in this folder, so every instance needs its own. */
  instanceEnv({ sessionsDir }) {
    return { PI_SESSION_DIR: sessionsDir };
  },

  /** At every process start. The adapter's directory is fixed when it starts, and it takes the MCP servers from here. */
  spawnEnv({ cwd, mcpServers = [] }) {
    const servers = piMcpServers(mcpServers);
    return {
      ...(cwd ? { AGENTD_BASE_CWD: cwd } : {}),
      // '' (not absent) so a value inherited from the daemon's own environment cannot leak in
      AGENTD_MCP_SERVERS: Object.keys(servers).length ? JSON.stringify(servers) : '',
    };
  },

  /**
   * Another endpoint and key: a private agent folder (`PI_CODING_AGENT_DIR`) with a `models.json` and the default model,
   * the key referenced by variable name. A folder of its own means pi's own logins are not seen by this instance.
   */
  provider: {
    protocol: 'openai',
    scope: 'process',
    apply({ provider, endpoint, model, dir, env = {} }) {
      // `contextWindow` is the provider's figure when it has one; left out, pi assumes 128K whatever the model really takes.
      const models = (provider.models?.length ? provider.models : [model]).filter(Boolean).map((id) => ({ id, ...(provider.contexts?.[id] ? { contextWindow: provider.contexts[id] } : {}), ...reasoningFor(id, env.PI_CLI, provider.id), compat: { supportsDeveloperRole: false } }));
      const modelsJson = { providers: { [provider.id]: { baseUrl: endpoint, api: 'openai-completions', apiKey: '$SCAFFOLD_PROVIDER_KEY', models } } };
      // pi falls back silently to its own default (an Anthropic model) when defaultModel is not in models.json, so refuse a model that is not listed.
      const exact = model ? models.find((m) => m.id === model)?.id : null;
      if (model && !exact) throw new Error(`model "${model}" is not one of provider "${provider.id}"'s models: ${models.map((m) => m.id).join(', ')}`);
      const settings = { defaultProvider: provider.id, ...(exact ? { defaultModel: exact } : {}) };
      return {
        env: { PI_CODING_AGENT_DIR: dir, SCAFFOLD_PROVIDER_KEY: provider.apiKey },
        args: [],
        files: [
          { name: 'models.json', content: JSON.stringify(modelsJson, null, 2) },
          { name: 'settings.json', content: JSON.stringify(settings, null, 2) },
        ],
        model: exact ? `${provider.id}/${exact}` : null,
      };
    },
  },

  rules({ file }) {
    return file ? { ...NO_RULES, env: { AGENTD_APPEND_SYSTEM_PROMPT_FILE: file } } : RULES_IN_PROMPT;
  },
};
