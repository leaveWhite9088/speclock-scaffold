/**
 * Scene presets and project-level prompt switching/overrides:
 *   1. built-in presets ("software-dev", "multi-agent-arena") load cleanly from contexts/
 *   2. editing a built-in preset writes only to presets.json (modified=true), and resetPreset restores the built-in text
 *   3. custom presets can be created and removed; built-in presets cannot be removed
 *   4. project creation & switching apply preset + append/override rules to both dispatcher and executors immediately
 *   5. the dispatcher is denied preset.save, preset.reset and preset.remove
 */

import '../lib/isolate.mjs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'agentd-presets-unit-'));
process.env.AGENTD_DATA_DIR = join(root, 'data');
process.env.AGENTD_PRESETS_FILE = join(root, 'data', 'global', 'presets.json');

const { check } = await import('../lib/scheduler.mjs');
const {
  DEFAULT_PRESET_ID,
  getPreset,
  listPresets,
  removePreset,
  resetPreset,
  resolveDispatcherRules,
  resolveExecutorBaseRules,
  savePreset,
} = await import('../../core/prompts/index.mjs');
const projects = await import('../../core/projects/index.mjs');
const { scopeArgs } = await import('../../daemon/guard.mjs');

console.log('\n=== scene presets & project prompt switching ===\n');

const throws = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e.message;
  }
};

// 1. Built-in presets
const initial = listPresets();
check('two built-in presets exist by default (software-dev and multi-agent-arena)', initial.map((p) => p.id).join() === 'software-dev,multi-agent-arena');
check('built-ins start unmodified with full dispatcher & executor rules', initial.every((p) => p.builtIn && !p.modified && p.dispatcherPrompt.length > 200 && p.executorPrompt.length > 200));
check('arena preset carries anti-cheat sandbox and omniscient commentary rules', /防作弊|全知/.test(getPreset('multi-agent-arena').dispatcherPrompt) && /严禁窥探/.test(getPreset('multi-agent-arena').executorPrompt));

// 2. Editing & resetting a built-in preset
const edited = savePreset({
  id: 'multi-agent-arena',
  name: '多智能体竞技博弈（改）',
  description: '自定义博弈说明',
  dispatcherPrompt: '# 自定义总导演规则\n\n第一轮盲拍。<!-- editor note -->',
  executorPrompt: '# 自定义席位底规\n\n严禁越界。',
});
check('editing a built-in preset marks it modified', edited.builtIn && edited.modified && edited.name === '多智能体竞技博弈（改）');
check('resolved dispatcher rules strip HTML comments', !resolveDispatcherRules({ presetId: 'multi-agent-arena' }).includes('editor note') && resolveDispatcherRules({ presetId: 'multi-agent-arena' }).includes('自定义总导演规则'));
check('built-in preset cannot be deleted', /built-in preset/.test(throws(() => removePreset('multi-agent-arena')) ?? ''));
const restored = resetPreset('multi-agent-arena');
check('resetPreset restores original built-in text and clears modified flag', restored.builtIn && !restored.modified && restored.name === '多智能体竞技博弈' && /赛事总导演/.test(restored.dispatcherPrompt));

// 3. Custom preset lifecycle & validation
check('invalid preset id is refused', /preset id/.test(throws(() => savePreset({ id: 'Bad Id', name: 'x', dispatcherPrompt: 'a', executorPrompt: 'b' })) ?? ''));
check('empty prompt is refused', /dispatcherPrompt/.test(throws(() => savePreset({ id: 'custom-1', name: 'x', dispatcherPrompt: '  ', executorPrompt: 'b' })) ?? ''));
const custom = savePreset({
  id: 'debate-club',
  name: '多模型辩论赛',
  description: '正反方立论与质询',
  dispatcherPrompt: '# 辩论主席规则',
  executorPrompt: '# 辩手通用底规',
});
check('custom preset is listed after built-ins', !custom.builtIn && listPresets().map((p) => p.id).join() === 'software-dev,multi-agent-arena,debate-club');

// 4. Project-level switching, append & override
const workA = join(root, 'work-a');
const workB = join(root, 'work-b');
mkdirSync(workA, { recursive: true });
mkdirSync(workB, { recursive: true });

const pSoft = projects.createProject({ id: 'soft', name: 'Soft', root: workA });
const pArena = projects.createProject({
  id: 'arena',
  name: 'Arena',
  root: workB,
  preset: 'multi-agent-arena',
  prompts: { dispatcherMode: 'append', dispatcherPrompt: '## 赛季补充\n预算上限 5800 万。', executorMode: 'inherit', executorPrompt: '' },
});
check('default project uses software-dev preset', pSoft.preset === DEFAULT_PRESET_ID && /规格库/.test(projects.projectDispatcherRules('soft')));
check('arena project uses multi-agent-arena plus appended project rules', pArena.preset === 'multi-agent-arena' && /赛事总导演/.test(projects.projectDispatcherRules('arena')) && /预算上限 5800 万/.test(projects.projectDispatcherRules('arena')));

projects.addInstance('arena', { id: 'team1', type: 'dsh', dir: '.', template: 'arena-competitor' });
const teamAgent = projects.instancesOf('arena')[0];
check('executor in arena project gets arena base rules + arena-competitor template rules', /严禁窥探与越界作弊/.test(teamAgent.rules) && /博弈参赛席位的工作方式/.test(teamAgent.rules) && !/规格里的业务规则/.test(teamAgent.rules));

// Live switch of project preset + override mode updates both dispatcher rules and existing executor rules immediately
projects.setProjectPrompts('arena', {
  preset: 'debate-club',
  prompts: { dispatcherMode: 'override', dispatcherPrompt: '# 本项目独立主席规则', executorMode: 'append', executorPrompt: '发言限 500 字。' },
});
check('switching project preset & override updates dispatcher rules immediately', projects.projectDispatcherRules('arena') === '# 本项目独立主席规则');
check('switching project preset & append updates executor rules immediately', teamAgent.rules.startsWith('# 辩手通用底规\n\n---\n\n发言限 500 字。'));
check('presetUsers tracks projects using a preset', projects.presetUsers('debate-club').map((u) => u.id).join() === 'arena');

projects.setProjectPrompts('arena', { preset: 'software-dev', prompts: null });
check('custom preset can be removed once unused', removePreset('debate-club').removed && listPresets().length === 2);

// 5. Security: dispatcher may not touch presets
for (const op of ['preset.save', 'preset.reset', 'preset.remove']) {
  check(`dispatcher is denied ${op}`, /dispatcher cannot do/.test(throws(() => scopeArgs(op, { caller: 'dispatcher', project: 'soft', id: 'x' })) ?? ''));
}

try {
  rmSync(root, { recursive: true, force: true });
} catch {}

console.log(process.exitCode ? '\n=> ✗ PRESETS BROKEN' : '\n=> ✓ PRESETS OK');
process.exit(process.exitCode ?? 0);
