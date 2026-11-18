import { useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useDispatcherModels, useDispatcherSessions, usePresets, useProject, useProviders } from '@/hooks/queries';
import { useDraft } from '@/hooks/useDraft';
import { api, enc, pq } from '@/lib/api';
import { effortOptions, modelLabel, when } from '@/lib/format';
import type { PromptMode } from '@/lib/types';
import { useUi } from '@/store';
import { RuntimeFields } from './RuntimeFields';
import { SessionsSection } from './SessionList';
import { DraftActions } from './parts';

const PROMPT_MODE_OPTIONS: { value: PromptMode; label: string }[] = [
  { value: 'inherit', label: '跟随场景预设' },
  { value: 'append', label: '在预设后追加本项目规则' },
  { value: 'override', label: '完全自定义替换' },
];

/** The same page as an executor's: provider, model, compaction, scene preset and project prompt overrides, then sessions. */
export function DispatcherSettings({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const reloadConversation = useUi((s) => s.reloadConversation);
  const project = useProject();
  const providers = useProviders().data?.providers ?? [];
  const presets = usePresets().data ?? [];
  const { data: models } = useDispatcherModels(projectId);
  const { data: sessions, error } = useDispatcherSessions(projectId);
  const chosen = project?.dispatcher?.provider ?? null;
  const saved = {
    provider: chosen?.id ?? '',
    providerModel: chosen?.model ?? '',
    model: models?.current ?? '',
    effort: models?.thinkingLevel ?? '',
    compactK: project?.dispatcher?.compactAt ? String(Math.round(project.dispatcher.compactAt / 1000)) : '',
    preset: project?.preset || 'software-dev',
    dispatcherMode: (project?.prompts?.dispatcherMode || 'inherit') as PromptMode,
    dispatcherPrompt: project?.prompts?.dispatcherPrompt || '',
    executorMode: (project?.prompts?.executorMode || 'inherit') as PromptMode,
    executorPrompt: project?.prompts?.executorPrompt || '',
  };
  const draft = useDraft(`draft:dispatcher:${projectId}`, saved);
  const v = draft.values;
  const activePreset = presets.find((p) => p.id === v.preset);
  const promptsValid =
    (v.dispatcherMode !== 'override' || Boolean(v.dispatcherPrompt.trim())) &&
    (v.executorMode !== 'override' || Boolean(v.executorPrompt.trim()));

  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: ['projects'] });
    await qc.invalidateQueries({ queryKey: ['presets'] });
    await qc.invalidateQueries({ queryKey: ['dispatcher-sessions', projectId] });
    await qc.invalidateQueries({ queryKey: ['dispatcher-models', projectId] });
    reloadConversation();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const providerChanged = v.provider !== saved.provider || (v.provider !== '' && v.providerModel !== saved.providerModel);
      const promptsChanged =
        v.dispatcherMode !== saved.dispatcherMode ||
        v.dispatcherPrompt !== saved.dispatcherPrompt ||
        v.executorMode !== saved.executorMode ||
        v.executorPrompt !== saved.executorPrompt;
      const patch: Record<string, unknown> = {};
      if (providerChanged) patch.provider = v.provider ? { id: v.provider, model: v.providerModel || providers.find((p) => p.id === v.provider)?.models[0] } : null;
      if (v.compactK.trim() !== saved.compactK) patch.compactAt = v.compactK.trim() ? Number(v.compactK) * 1000 : null;
      if (v.preset !== saved.preset) patch.preset = v.preset;
      if (promptsChanged) {
        patch.prompts = {
          dispatcherMode: v.dispatcherMode,
          dispatcherPrompt: v.dispatcherPrompt,
          executorMode: v.executorMode,
          executorPrompt: v.executorPrompt,
        };
      }
      if (Object.keys(patch).length) await api('PATCH', `/api/projects/${enc(projectId)}/dispatcher`, patch);
      // pi's own models: the choice is made on the running dispatcher (a new provider starts it again first)
      if (!v.provider && v.model !== saved.model) await api('POST', `/api/dispatcher/model${pq(projectId)}`, { value: v.model });
      // the reasoning level is set on the running dispatcher, whatever model it runs on
      if (v.effort && v.effort !== saved.effort) await api('POST', `/api/dispatcher/thinking${pq(projectId)}`, { level: v.effort });
      draft.clear();
      toast('已提交');
      await refreshAll();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="grid gap-2.5">
        <Field label="场景预设">
          <Select
            value={v.preset}
            onChange={(x) => draft.set({ preset: x })}
            options={
              presets.length
                ? presets.map((p) => ({ value: p.id, label: p.name }))
                : [
                    { value: 'software-dev', label: '软件工程研发' },
                    { value: 'multi-agent-arena', label: '多智能体竞技博弈' },
                    { value: 'media-studio', label: '自媒体内容工坊' },
                  ]
            }
          />
        </Field>
        <Field label="调度规则">
          <Select value={v.dispatcherMode} onChange={(x) => draft.set({ dispatcherMode: x as PromptMode })} options={PROMPT_MODE_OPTIONS} />
        </Field>
        {v.dispatcherMode !== 'inherit' ? (
          <div className="grid gap-1.5">
            {v.dispatcherMode === 'override' && !v.dispatcherPrompt.trim() && activePreset ? (
              <div className="flex justify-end">
                <Button size="none" className="h-6 px-2 text-[12px]" onClick={() => draft.set({ dispatcherPrompt: activePreset.dispatcherPrompt })}>
                  填入当前预设原文作为底稿
                </Button>
              </div>
            ) : null}
            <Textarea
              mono
              className="h-36 resize-y"
              placeholder={v.dispatcherMode === 'append' ? '附加在场景预设总调度器规则之后的本项目专属细则（如特定命令、轮次规则）' : '完全替换本项目的总调度器系统提示词'}
              value={v.dispatcherPrompt}
              onChange={(e) => draft.set({ dispatcherPrompt: e.target.value })}
            />
          </div>
        ) : null}
        <Field label="执行底规">
          <Select value={v.executorMode} onChange={(x) => draft.set({ executorMode: x as PromptMode })} options={PROMPT_MODE_OPTIONS} />
        </Field>
        {v.executorMode !== 'inherit' ? (
          <div className="grid gap-1.5">
            {v.executorMode === 'override' && !v.executorPrompt.trim() && activePreset ? (
              <div className="flex justify-end">
                <Button size="none" className="h-6 px-2 text-[12px]" onClick={() => draft.set({ executorPrompt: activePreset.executorPrompt })}>
                  填入当前预设原文作为底稿
                </Button>
              </div>
            ) : null}
            <Textarea
              mono
              className="h-32 resize-y"
              placeholder={v.executorMode === 'append' ? '附加在场景预设执行者底规之后的本项目专属要求' : '完全替换本项目所有执行者的通用底规'}
              value={v.executorPrompt}
              onChange={(e) => draft.set({ executorPrompt: e.target.value })}
            />
          </div>
        ) : null}
        <RuntimeFields
          type="pi"
          providerId={v.provider}
          providerModel={v.providerModel}
          onProvider={(id, model) => draft.set({ provider: id, providerModel: model })}
          onProviderModel={(model) => draft.set({ providerModel: model })}
          effort={{ value: v.effort, disabled: !models, onChange: (x) => draft.set({ effort: x }), options: effortOptions((models?.thinkingLevels ?? []).map((l) => ({ value: l, name: l })), null, saved.effort).filter((o) => o.value !== '') }}
          base={{ value: v.model, disabled: !models, onChange: (x) => draft.set({ model: x }), options: (models?.models ?? []).map((x) => ({ value: x.value, label: modelLabel(x.value, x.name) })) }}
        />
        <Field label="压缩">
          <Input type="number" min={10} step={1} placeholder="K tokens，留空不压缩" value={v.compactK} onChange={(e) => draft.set({ compactK: e.target.value })} />
        </Field>
        {project?.root ? (
          <Field label="根目录">
            <div className="truncate text-[13px]" title={project.root}>
              {project.root}
            </div>
          </Field>
        ) : null}
        <DraftActions dirty={draft.dirty} valid={promptsValid} submitText="提交修改" onUndo={draft.undo} />
      </form>

      <SessionsSection
        onNew={async () => {
          await api('POST', `/api/dispatcher/new${pq(projectId)}`);
          await refreshAll();
        }}
        rows={sessions?.map((s) => ({ key: s.file, title: s.label || s.title || (s.sessionId ?? '').slice(0, 8), sub: when(s.updatedAt), current: Boolean(s.active) }))}
        error={error?.message}
        emptyText="还没有会话"
        onUse={async (file) => {
          await api('POST', `/api/dispatcher/use${pq(projectId)}`, { sessionFile: file });
          await refreshAll();
        }}
        onRename={async (file, label) => {
          await api('POST', `/api/dispatcher/rename${pq(projectId)}`, { sessionFile: file, label });
          await refreshAll();
        }}
        onDelete={async (file) => {
          await api('DELETE', `/api/dispatcher/sessions${pq(projectId)}&file=${enc(file)}`);
          await refreshAll();
        }}
      />
    </>
  );
}
