/**
 * Unit test for the models.json editor (no daemon, no LLM).
 * Everything happens in a temp directory; the real ~/.pi is never touched.
 *
 * Usage: node test/unit/pi-models-test.mjs
 */

import '../lib/isolate.mjs';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPiProvider, removePiProvider, listPiProviders } from '../../core/pi/models.mjs';
import { check } from '../lib/scheduler.mjs';

console.log('\n=== pi-models (models.json editor) ===\n');

const dir = mkdtempSync(join(tmpdir(), 'pi-models-'));
const throwsWith = (fn, re) => {
  try {
    fn();
    return false;
  } catch (e) {
    return re.test(e.message);
  }
};

const base = {
  provider: 'deepseek-test',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '$DEEPSEEK_API_KEY',
  models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
};

// validation
check('apiKey starting with "!" is rejected', throwsWith(() => addPiProvider({ ...base, apiKey: '!cat secret' }, dir), /shell command/));
check('bad provider name is rejected', throwsWith(() => addPiProvider({ ...base, provider: 'Bad Name' }, dir), /provider must be/));
check('non-http baseUrl is rejected', throwsWith(() => addPiProvider({ ...base, baseUrl: 'file:///etc/passwd' }, dir), /http or https/));
check('new provider needs a model', throwsWith(() => addPiProvider({ ...base, models: [] }, dir), /at least one model/));
check('new provider needs a key', throwsWith(() => addPiProvider({ ...base, apiKey: undefined }, dir), /apiKey is required/));
check('nothing was written by failed calls', !existsSync(join(dir, 'models.json')));

// add
const a = addPiProvider(base, dir);
check('add creates the provider', a.created === true && a.models.join() === 'deepseek-chat');
const disk = JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8'));
check('file has the provider and default api', disk.providers['deepseek-test']?.api === 'openai-completions');

// merge
const b = addPiProvider({ provider: 'deepseek-test', models: [{ id: 'deepseek-reasoner', reasoning: true }] }, dir);
check('adding models to an existing provider merges', b.created === false && b.models.join() === 'deepseek-chat,deepseek-reasoner');
check('baseUrl and key are kept on merge', JSON.parse(readFileSync(join(dir, 'models.json'), 'utf8')).providers['deepseek-test'].apiKey === '$DEEPSEEK_API_KEY');
check('previous file is kept as .bak', existsSync(join(dir, 'models.json.bak')));

// list masks literal keys
addPiProvider({ provider: 'lit', baseUrl: 'http://localhost:1234/v1', apiKey: 'sk-secret-123', models: [{ id: 'm1' }] }, dir);
const list = listPiProviders(dir);
const lit = list.providers.find((p) => p.provider === 'lit');
check('literal key is masked in the listing', lit.apiKey === '(literal key set)' && !JSON.stringify(list).includes('sk-secret-123'));
check('env reference is shown as is', list.providers.find((p) => p.provider === 'deepseek-test').apiKey === '$DEEPSEEK_API_KEY');

// remove
const r1 = removePiProvider('deepseek-test', ['deepseek-chat'], dir);
check('removing one model keeps the other', r1.remaining.join() === 'deepseek-reasoner');
removePiProvider('deepseek-test', null, dir);
removePiProvider('lit', null, dir);
check('removing providers empties the list', listPiProviders(dir).providers.length === 0);
check('removing an unknown provider fails', throwsWith(() => removePiProvider('nope', null, dir), /not in models.json/));

console.log(process.exitCode ? '\n=> ✗ PI-MODELS BROKEN' : '\n=> ✓ PI-MODELS OK');
