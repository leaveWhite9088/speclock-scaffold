import { useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useDispatcherModels, useDispatcherSessions, useProject, useProviders } from '@/hooks/queries';
import { useDraft } from '@/hooks/useDraft';
import { api, enc, pq } from '@/lib/api';
import { modelLabel, when } from '@/lib/format';
import { useUi } from '@/store';
import { RuntimeFields } from './RuntimeFields';
import { SessionsSection } from './SessionList';
import { DraftActions } from './parts';

/** The same page as an executor's: provider, model, compaction, with one submit button; then the sessions. */
export function DispatcherSettings({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const reloadConversation = useUi((s) => s.reloadConversation);
  const project = useProject();
  const providers = useProviders().data?.providers ?? [];
  const { data: models } = useDispatcherModels(projectId);
  const { data: sessions, error } = useDispatcherSessions(projectId);
  const chosen = project?.dispatcher?.provider ?? null;
  const saved = {
    provider: chosen?.id ?? '',
    providerModel: chosen?.model ?? '',
    model: models?.current ?? '',
    compactK: project?.dispatcher?.compactAt ? String(Math.round(project.dispatcher.compactAt / 1000)) : '',
  };
  const draft = useDraft(`draft:dispatcher:${projectId}`, saved);
  const v = draft.values;

  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: ['projects'] });
    await qc.invalidateQueries({ queryKey: ['dispatcher-sessions', projectId] });
    await qc.invalidateQueries({ queryKey: ['dispatcher-models', projectId] });
    reloadConversation();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const providerChanged = v.provider !== saved.provider || (v.provider !== '' && v.providerModel !== saved.providerModel);
      const patch: Record<string, unknown> = {};
      if (providerChanged) patch.provider = v.provider ? { id: v.provider, model: v.providerModel || providers.find((p) => p.id === v.provider)?.models[0] } : null;
      if (v.compactK.trim() !== saved.compactK) patch.compactAt = v.compactK.trim() ? Number(v.compactK) * 1000 : null;
      if (Object.keys(patch).length) await api('PATCH', `/api/projects/${enc(projectId)}/dispatcher`, patch);
      // pi's own models: the choice is made on the running dispatcher (a new provider starts it again first)
      if (!v.provider && v.model !== saved.model) await api('POST', `/api/dispatcher/model${pq(projectId)}`, { value: v.model });
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
        <RuntimeFields
          type="pi"
          providerId={v.provider}
          providerModel={v.providerModel}
          onProvider={(id, model) => draft.set({ provider: id, providerModel: model })}
          onProviderModel={(model) => draft.set({ providerModel: model })}
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
        <DraftActions dirty={draft.dirty} valid submitText="提交修改" onUndo={draft.undo} />
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
