/**
 * Backend API regression. Starts the server on a spare port and talks to it
 * over HTTP, the way the dashboard does. Everything belongs to a project, so it makes one with an executor. One `dsh` run is
 * made for the run -> SSE -> transcript path; the dispatcher is only queried, not prompted.
 *
 * Usage: node test/api-test.mjs [agent]
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AG = process.argv[2] || 'dsh';
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let failed = false;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed = true;
};

console.log('\n=== backend API ===\n');

const server = spawn(process.execPath, [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], {
  env: { ...process.env, BACKEND_PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const api = async (method, path, body, headers = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

try {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(BASE + '/api/health');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // read routes
  const agents = await api('GET', '/api/agents');
  check('GET /api/agents answers (executors only exist inside projects)', agents.status === 200 && Array.isArray(agents.body.agents));
  const health = await api('GET', '/api/health');
  check('GET /api/health answers', health.status === 200);
  const unknown = await api('GET', '/api/nope');
  check('unknown route is 404', unknown.status === 404);

  // guard
  const badHost = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/agents', headers: { host: 'evil.example.com' } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    });
  });
  check('non-local Host is refused', badHost === 403);
  const badOrigin = await api('POST', '/api/dispatcher/abort', {}, { origin: 'https://evil.example.com' });
  check('cross-site POST is refused', badOrigin.status === 403);

  // a project with one executor: nothing works outside one
  const pid = `p${Date.now().toString(36)}`;
  const proot = mkdtempSync(join(tmpdir(), 'backend-proj-'));
  const pc = await api('POST', '/api/projects', { id: pid, root: proot });
  check('POST /api/projects creates a project', pc.status === 200);
  const pi = await api('POST', `/api/projects/${pid}/instances`, { id: 'one', type: AG, dir: '.', role: 'tester' });
  check('POST project instance works', pi.status === 200);
  const dup = await api('POST', `/api/projects/${pid}/instances`, { id: 'one', type: AG, dir: '.' });
  check('duplicate executor is a 4xx with a message', dup.status === 400 && /already exists/.test(dup.body.error));
  const gone = await api('POST', '/api/instances', { id: 'x', type: AG, cwd: proot });
  check('there is no way to create an executor outside a project', gone.status === 404);
  const id = `${pid}~one`;

  // SSE + run + transcript
  const events = [];
  const ac = new AbortController();
  const sse = await fetch(BASE + '/api/events', { signal: ac.signal });
  check('GET /api/events opens an event stream', sse.status === 200 && /event-stream/.test(sse.headers.get('content-type')));
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of sse.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const name = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (name && data) events.push({ name, data: JSON.parse(data) });
        }
      }
    } catch {
      /* aborted */
    }
  })();

  const run = await api('POST', `/api/agents/${id}/run`, { prompt: 'Reply with exactly: GATEWAY' });
  check('POST run returns a job id at once', run.status === 200 && Boolean(run.body.jobId));
  const noPrompt = await api('POST', `/api/agents/${id}/run`, {});
  check('run without prompt is 400', noPrompt.status === 400);

  const t0 = Date.now();
  while (!events.some((e) => e.name === 'job.done' && e.data.jobId === run.body.jobId) && Date.now() - t0 < 240_000) {
    await new Promise((r) => setTimeout(r, 300));
  }
  const done = events.find((e) => e.name === 'job.done' && e.data.jobId === run.body.jobId);
  check('job.done arrives over SSE', Boolean(done));
  check('result text is in the event', /GATEWAY/i.test(done?.data?.result?.text ?? ''));

  const sid = done?.data?.result?.sessionId;
  const tr = await api('GET', `/api/agents/${id}/sessions/${sid}/transcript`);
check('transcript has the user and assistant entries (a model may add its reasoning as a thought)', tr.status === 200 && tr.body.entries.filter((e) => e.role !== 'thought').map((e) => e.role).join() === 'user,assistant', tr.body.entries?.map((e) => e.role).join());
  const after = await api('GET', `/api/agents/${id}/sessions/${sid}/transcript?afterSeq=${tr.body.entries[0].seq}`);
check('afterSeq passes through', after.body.entries.length >= 1 && after.body.entries.every((e) => e.seq > tr.body.entries[0].seq) && after.body.entries.some((e) => e.role === 'assistant'));
  const ss = await api('GET', `/api/agents/${id}/sessions`);
  check('sessions route lists the session', ss.body.sessions.some((s) => s.sessionId === sid));

  // dispatcher (no LLM call)
  const dm = await api('GET', '/api/dispatcher/models');
  check('a dispatcher without a project is refused', dm.status >= 400 && /project is required/.test(dm.body.error), JSON.stringify(dm.body).slice(0, 80));
  const llms = await api('GET', '/api/dispatcher/llms');
  check('dispatcher llms route answers without literal keys', llms.status === 200 && !/"apiKey":"(?!\$|\(literal)/.test(JSON.stringify(llms.body)));
  const badLlm = await api('POST', '/api/dispatcher/llms', { provider: 'x', baseUrl: 'https://x.test', apiKey: '!rm -rf', models: [{ id: 'm' }] });
  check('apiKey starting with ! is refused', badLlm.status === 400 && /shell command/.test(badLlm.body.error));

  // projects
  const esc = await api('POST', `/api/projects/${pid}/instances`, { id: 'two', type: AG, dir: '..' });
  check('dir escaping the root is a 4xx', esc.status === 400 && /outside/.test(esc.body.error));
  const st = await api('POST', `/api/agents/${pid}~one/start`);
  check('POST start brings the process up', st.status === 200 && st.body.alive === true, JSON.stringify(st.body).slice(0, 80));
  const pl = await api('GET', '/api/projects');
  const mine = pl.body.projects.find((p) => p.id === pid);
  check('GET /api/projects lists it with instances and limits', Boolean(mine?.instances.some((i) => i.key === `${pid}~one`)) && pl.body.limits.maxProcesses > 0);
  const patch = await api('PATCH', `/api/projects/${pid}/instances/one`, { role: 'edited' });
  check('PATCH project instance edits it', patch.status === 200 && patch.body.role === 'edited');
  const dsess = await api('GET', `/api/dispatcher/sessions?project=${pid}`);
  check('dispatcher sessions route answers', dsess.status === 200 && Array.isArray(dsess.body.sessions));
  const pd = await api('GET', `/api/dispatcher/models?project=${pid}`);
  check('project dispatcher models route answers', pd.status === 200 && pd.body.models.length > 0);
  const pdel = await api('DELETE', `/api/projects/${pid}`);
  check('DELETE /api/projects/:id removes it', pdel.status === 200);

  // providers: kept on the device, the key goes in and never comes out
  const KEY = 'sk-api-test-0123456789';
  const provId = `api${Date.now().toString(36)}`;
  const saved = await api('POST', '/api/providers', { id: provId, name: 'api test', apiKey: KEY, endpoints: { openai: 'https://api.example.test/v1' }, models: ['m1'] });
  check('POST /api/providers saves one', saved.status === 200 && saved.body?.id === provId && saved.body?.keyHint === '…6789', JSON.stringify(saved.body));
  const plist = await api('GET', '/api/providers');
  const prow = plist.body?.providers?.find((p) => p.id === provId);
  check('GET /api/providers lists it without the key', Boolean(prow) && !JSON.stringify(plist.body).includes(KEY) && prow.support.some((s) => s.type === 'opencode' && s.supported) && !prow.support.find((s) => s.type === 'claude').supported);
  const badp = await api('POST', '/api/providers', { id: provId, apiKey: KEY, endpoints: {}, models: ['m1'] });
  check('a provider without an endpoint is refused', badp.status >= 400, JSON.stringify(badp.body));
  const delp = await api('DELETE', `/api/providers/${provId}`);
  check('DELETE /api/providers/:id removes it', delp.status === 200 && !(await api('GET', '/api/providers')).body.providers.some((p) => p.id === provId));

  ac.abort();
} finally {
  server.kill();
}

console.log(failed ? '\n=> ✗ BACKEND BROKEN' : '\n=> ✓ BACKEND OK');
process.exitCode = failed ? 1 : 0;
