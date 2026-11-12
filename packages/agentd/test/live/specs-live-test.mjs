/**
 * An executor's role in SpecLock Core, against the real Core (set up and started by agentd in a folder of its own, on a
 * port of its own). Skipped when there is no Core checkout with its environment built next to this repository.
 *
 * Checks:
 *   1. nothing is started or set up until a role is picked
 *   2. creating an executor with a role makes a project in Core, a key bound to it, and puts the MCP server in the executor
 *      (the entry names the key file, never the key) and the role's rules in its prompt
 *   3. the key works and is the role and the project that were asked for; another project's executor has another project
 *   4. a role that is not one is refused before anything is made; a duplicate name leaves no key behind
 *   5. changing the role replaces the key; "none" takes it away and the executor is left without the server
 *   6. removing an executor revokes its key
 */

import '../lib/isolate.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.AGENTD_SPECLOCK_PORT = '47833';
// The test runs in a data folder of its own, so the Core the scaffold fetched (or one next to the repository) is looked for in the real places and handed over by name.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const real = [join(here, '..', '..', 'data', 'global', 'tools', 'speclock-core'), join(here, '..', '..', '..', '..', '..', 'speclock-core')].find((d) => existsSync(join(d, 'pyproject.toml')) && existsSync(join(d, '.venv')));
  if (real) process.env.AGENTD_SPECLOCK_DIR = real;
}
const specs = await import('../../core/specs/index.mjs');
const { check } = await import('../lib/scheduler.mjs');

console.log('\n=== SpecLock role of an executor ===\n');

const s0 = await specs.status();
if (!s0.found || !s0.built) {
  console.log(`skipped: no built Core at ${s0.dir} (uv sync there first)`);
  process.exit(0);
}

const { buildOps } = await import('../../daemon/ops/index.mjs');
const { GLOBAL_DIR, projectPath } = await import('../../core/base/index.mjs');
const { pool } = await import('../../core/pool/index.mjs');
const ops = buildOps({ protocol: 3, startedAt: 'now', idleInstanceMs: 1000 });
const keysDir = join(GLOBAL_DIR, '.speclock', 'keys');
const keyFiles = () => (existsSync(keysDir) ? readdirSync(keysDir).filter((f) => f.endsWith('.key') && !f.startsWith('viewer--')).sort() : []);

try {
  // 1
  check('before a role is picked nothing is set up', !s0.setUp && !s0.running && !existsSync(join(GLOBAL_DIR, '.speclock')));

  const rootA = mkdtempSync(join(tmpdir(), 'specs-a-'));
  const rootB = mkdtempSync(join(tmpdir(), 'specs-b-'));
  mkdirSync(join(rootA, 'server'));
  await ops['project.create']({ id: 'shop', name: 'Shop', root: rootA });
  await ops['project.create']({ id: 'blog', name: 'Blog', root: rootB });

  // 4 (first, before any key exists)
  let refused = '';
  await ops['project.addInstance']({ project: 'shop', id: 'x', type: 'dsh', dir: '.', spec: 'god' }).catch((e) => (refused = e.message));
  check('a role that is not one is refused', /unknown SpecLock role/.test(refused), refused);
  check('…and nothing was made for it', !pool.has('shop~x') && !existsSync(join(GLOBAL_DIR, '.speclock')));

  // 2
  const made = await ops['project.addInstance']({ project: 'shop', id: 'backend', type: 'dsh', dir: './server', spec: 'executor' });
  check('the executor says which role it has', made.spec === 'executor', JSON.stringify(made.spec));
  const up = await specs.status();
  check('Core was set up and is running (version known)', up.setUp && up.running && /^\d/.test(up.version ?? ''), JSON.stringify(up));
  check('it sits in agentd’s own data folder', existsSync(join(GLOBAL_DIR, '.speclock', 'config.toml')) && existsSync(join(GLOBAL_DIR, 'specs.json')));
  check('the key is a file bound to the executor', keyFiles().join() === 'executor-agent--shop-backend.key', keyFiles().join());

  const agent = pool.get('shop~backend');
  const servers = agent.spec.mcpServers();
  const entry = servers.find((m) => m.name === 'speclock');
  const keyText = readFileSync(join(keysDir, 'executor-agent--shop-backend.key'), 'utf8').trim();
  check('the executor carries the SpecLock MCP server', Boolean(entry) && entry.args.includes('--key-file') && entry.args.includes('executor-agent--shop-backend.key'), JSON.stringify(entry));
  check('the entry holds no key', !JSON.stringify(servers).includes(keyText));
  const { setSpecMcpResolver } = await import('../../core/projects/index.mjs');
  setSpecMcpResolver((e) => ({ ...e, command: 'the-current-python' }));
  check('the daemon can make executors follow the Core that is current, not the one their key was made under', agent.spec.mcpServers().find((m) => m.name === 'speclock').command === 'the-current-python');
  setSpecMcpResolver(null);
  check('without it the entry is used as saved', agent.spec.mcpServers().find((m) => m.name === 'speclock').command === entry.command);
  check('the status says which Python Core runs on', up.python === specs.corePython());
  check('its prompt has the SpecLock rules for its role', /规格库里的角色：执行/.test(agent.spec.systemPrompt()) && /自己找 key/.test(agent.spec.systemPrompt()));
  check('the saved executor file holds no key either', !readFileSync(projectPath('shop', 'project.json'), 'utf8').includes(keyText));
  const shown = (await ops.projects()).projects.find((p) => p.id === 'shop').instances.find((i) => i.id === 'backend');
  check('the project list shows the role and no key', shown.spec === 'executor' && !JSON.stringify(shown).includes(keyText));

  // 3
  const url = up.url;
  const me = async (key) => (await fetch(`${url}/api/v1/me`, { headers: { 'X-API-Key': key } })).json();
  const mine = await me(keyText);
  check('the key is an executor-agent key bound to a project', mine.role === 'executor-agent' && Number.isInteger(mine.project_id), JSON.stringify(mine));
  await ops['project.addInstance']({ project: 'blog', id: 'qa', type: 'dsh', dir: '.', spec: 'tester' });
  const other = await me(readFileSync(join(keysDir, 'tester-agent--blog-qa.key'), 'utf8').trim());
  check('another project’s executor is in another Core project', other.role === 'tester-agent' && other.project_id !== mine.project_id, JSON.stringify(other));
  check('each project has one place in Core', JSON.parse(readFileSync(projectPath('shop', 'specs.json'), 'utf8')).coreProjectId === mine.project_id);

  // 4 (a duplicate name)
  const before = keyFiles().join();
  let dup = '';
  await ops['project.addInstance']({ project: 'shop', id: 'backend', type: 'dsh', dir: '.', spec: 'tester' }).catch((e) => (dup = e.message));
  check('a duplicate name is refused', /already exists/.test(dup), dup);
  check('…and leaves no key behind', keyFiles().join() === before, keyFiles().join());

  // 5
  await ops['project.updateInstance']({ project: 'shop', id: 'backend', spec: 'tester' });
  check('a new role replaces the key', keyFiles().includes('tester-agent--shop-backend.key') && !keyFiles().includes('executor-agent--shop-backend.key'), keyFiles().join());
  check('the old key no longer works', (await fetch(`${url}/api/v1/me`, { headers: { 'X-API-Key': keyText } })).status === 401);
  check('the prompt follows the role', /规格库里的角色：测试/.test(pool.get('shop~backend').spec.systemPrompt()));
  await ops['project.updateInstance']({ project: 'shop', id: 'backend', role: 'backend service' });
  check('editing something else leaves the key alone', keyFiles().includes('tester-agent--shop-backend.key'));
  await ops['project.updateInstance']({ project: 'shop', id: 'backend', spec: 'none' });
  check('"none" takes the key and the server away', !keyFiles().some((f) => f.includes('shop-backend')) && pool.get('shop~backend').spec.mcpServers().length === 0, keyFiles().join());

  // 7: a template suggests a role; the request can overrule it
  const fromTpl = await ops['project.addInstance']({ project: 'shop', id: 'pm', type: 'dsh', template: 'business-agent' });
  check('a template’s suggested role applies when the request says nothing', fromTpl.spec === 'requirements', String(fromTpl.spec));
  const overruled = await ops['project.addInstance']({ project: 'shop', id: 'pm2', type: 'dsh', template: 'business-agent', spec: 'none' });
  check('"none" in the request overrules the template', overruled.spec === null, String(overruled.spec));
  const other2 = await ops['project.addInstance']({ project: 'shop', id: 'pm3', type: 'dsh', template: 'business-agent', spec: 'scanner' });
  check('another role in the request overrules it too', other2.spec === 'scanner', String(other2.spec));
  const roster = (await ops.instances({ project: 'shop' })).instances;
  check('the instances the dispatcher reads carry the role', roster.find((r) => r.shortId === 'pm')?.spec === 'requirements' && roster.find((r) => r.shortId === 'pm2')?.spec === null);

  // 8: the dispatcher gets Core with the project admin key, from a file
  const entryD = specs.dispatcherServer('shop');
  const adminFile = projectPath('shop', 'specs-admin.key');
  const adminKey = readFileSync(adminFile, 'utf8').trim();
  check('the dispatcher’s entry names the key file and holds no key', entryD?.name === 'speclock' && entryD.args.includes(adminFile) && !JSON.stringify(entryD).includes(adminKey), JSON.stringify(entryD));
  const speak = (entry, calls) =>
    new Promise((resolve, reject) => {
      const child = spawn(entry.command, entry.args, { env: { ...process.env, ...Object.fromEntries(entry.env.map((e) => [e.name, e.value])), PYTHONUTF8: '1' }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      const got = new Map();
      let buf = '';
      const timer = setTimeout(() => (child.kill(), reject(new Error('the MCP server did not answer'))), 30_000);
      child.stdout.on('data', (d) => {
        buf += d;
        let at;
        while ((at = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, at).trim();
          buf = buf.slice(at + 1);
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.id != null) got.set(m.id, m);
          if (got.size === calls.length + 1) (clearTimeout(timer), child.kill(), resolve(got));
        }
      });
      const send = (o) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
      send({ id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
      send({ method: 'notifications/initialized' });
      calls.forEach((c, i) => send({ id: i + 1, ...c }));
    });
  const answers = await speak(entryD, [{ method: 'tools/list', params: {} }, { method: 'tools/call', params: { name: 'whoami', arguments: {} } }]);
  const toolNames = (answers.get(1)?.result?.tools ?? []).map((t) => t.name);
  check('Core’s MCP gives the dispatcher the approval and work tools', ['approve_change_request', 'list_change_requests', 'list_work', 'get_change_request'].every((n) => toolNames.includes(n)), `${toolNames.length} tools`);
  const who = JSON.parse(JSON.parse(answers.get(2)?.result?.content?.[0]?.text ?? '{}').body ? answers.get(2).result.content[0].text : '{}');
  check('it acts as the project’s admin, bound to the project', who.body?.role === 'project-admin' && who.body?.project_id === mine.project_id, JSON.stringify(who).slice(0, 200));

  // the dispatcher process starts with the bridge and the servers (only where pi is installed)
  const { getDispatcher, dispatchers } = await import('../../daemon/dispatchers.mjs');
  const disp = getDispatcher('shop');
  try {
    await disp.ensureStarted();
    const cmdline = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${disp.pi.child.pid}").CommandLine`], { encoding: 'utf8' });
    check('the dispatcher started with the MCP client and bridge, not --no-mcp', disp.startedWithMcp && /builtin:mcp/.test(cmdline) && /mcp-bridge/.test(cmdline) && !/--no-mcp/.test(cmdline), cmdline.slice(-200));
  } catch (err) {
    console.log(`  - dispatcher start not checked (${err.message.slice(0, 100)})`);
  } finally {
    await disp.shutdown().catch(() => {});
    dispatchers.delete('shop');
  }

  // 6
  await ops['project.removeInstance']({ project: 'blog', id: 'qa' });
  check('removing an executor revokes its key', !keyFiles().some((f) => f.includes('blog-qa')), keyFiles().join());
} finally {
  specs.stop();
}

console.log(process.exitCode ? '\n=> ✗ SPECLOCK ROLE BROKEN' : '\n=> ✓ SPECLOCK ROLE OK');
process.exit(process.exitCode ?? 0);
