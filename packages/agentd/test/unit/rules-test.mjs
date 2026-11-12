/**
 * The rules texts agentd hands to its agents are what they should be: loaded, free of editor comments, and the
 * executor's covers its scope, its limits, the commands that never end, and how to report.
 */

import '../lib/isolate.mjs';
import { dispatcherRules, executorRules, specRules } from '../../core/prompts/rules.mjs';
import { check } from '../lib/scheduler.mjs';

console.log('\n=== the rules texts ===\n');

const e = executorRules();
const d = dispatcherRules();
check('the executor rules are there and have no editor comments', e.length > 300 && !e.includes('<!--'));
check('they cover scope, limits and reporting', ['## 范围', '## 约束', '## 回报'].every((h) => e.includes(h)));
check('they say not to run a command that never exits in the foreground', e.includes('## 不会自己结束的命令') && /npm run dev/.test(e) && /放到后台运行/.test(e));
check('they say how to put it in the background, and how to leave it to the user', /Start-Process/.test(e) && /nohup/.test(e) && /用户自己/.test(e));
check('the dispatcher rules are there too, and say a failure goes to the person', d.length > 300 && /等用户决定/.test(d));
check('the dispatcher is not told the executor-only rules', !d.includes('## 不会自己结束的命令'));

// how a module is shared out: one owner claims and submits, the others only read and report
const ex = specRules('executor');
check('an executor is told whether it is the owner or a participant of a work item', /负责人/.test(ex) && /参与者/.test(ex) && /不要领取，不要提交/.test(ex));
check('the owner puts the others’ evidence in, naming who said it, and does not invent any', /写明是谁说的/.test(ex) && /不要.*编证据/.test(ex));
check('a participant reports which acceptance conditions it covers, and the dispatcher is the only one who relays', /覆盖了哪些验收条件/.test(ex) && /调度器会把它转给负责人/.test(ex));
check('the tester checks the whole feature end to end and does not trust the evidence', /端到端/.test(specRules('tester')) && /自己去测/.test(specRules('tester')));
check('the requirements agent writes acceptance conditions as business behaviour', /验收条件写成业务行为/.test(specRules('requirements')) && /哪些模块（名称和版本）/.test(specRules('requirements')));
check('the dispatcher names an owner, marks every message, and does not claim or verify itself', /指定负责人/.test(d) && /【按规格安排】/.test(d) && /你自己不领取、不提交、不验收/.test(d));
check('it says what “implemented” means and asks before an end-to-end check', /已实现只表示/.test(d) && /不要自动做/.test(d));
console.log(process.exitCode ? '\n=> ✗ RULES BROKEN' : '\n=> ✓ RULES OK');
process.exit(process.exitCode ?? 0);
