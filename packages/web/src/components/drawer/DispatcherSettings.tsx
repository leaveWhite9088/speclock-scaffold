import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { useDispatcherModels, useDispatcherSessions, useProject } from '@/hooks/queries';
import { api, enc, pq } from '@/lib/api';
import { modelLabel, when } from '@/lib/format';
import { useUi } from '@/store';
import { SessionsSection } from './SessionList';

export function DispatcherSettings({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const reloadConversation = useUi((s) => s.reloadConversation);
  const project = useProject();
  const { data: models } = useDispatcherModels(projectId);
  const { data: sessions, error } = useDispatcherSessions(projectId);
  const [switching, setSwitching] = useState(false);
  const savedK = project?.dispatcher?.compactAt ? String(Math.round(project.dispatcher.compactAt / 1000)) : '';
  const [compactK, setCompactK] = useState<string | null>(null); // null: showing the saved value
  const shownK = compactK ?? savedK;

  // Applied when the field is left: the same way the model is, with no separate submit.
  const saveCompact = async () => {
    const v = (compactK ?? savedK).trim();
    setCompactK(null);
    if (v === savedK) return;
    try {
      await api('PATCH', `/api/projects/${enc(projectId)}/dispatcher`, { compactAt: v ? Number(v) * 1000 : null });
      toast(v ? `调度器超过 ${v}K tokens 自动压缩` : '调度器不自动压缩');
      await qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: ['projects'] });
    await qc.invalidateQueries({ queryKey: ['dispatcher-sessions', projectId] });
    reloadConversation();
  };

  const setModel = async (value: string) => {
    setSwitching(true);
    try {
      await api('POST', `/api/dispatcher/model${pq(projectId)}`, { value });
      await qc.invalidateQueries({ queryKey: ['dispatcher-models', projectId] });
      toast('调度器模型已切换');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <>
      <div className="grid gap-2.5">
        <Field label="模型">
          <Select value={models?.current ?? ''} onChange={(v) => void setModel(v)} disabled={switching || !models} options={(models?.models ?? []).map((x) => ({ value: x.value, label: modelLabel(x.value, x.name) }))} />
        </Field>
        <Field label="压缩">
          <Input
            type="number"
            min={10}
            step={1}
            placeholder="K tokens，留空不压缩"
            value={shownK}
            onChange={(e) => setCompactK(e.target.value)}
            onBlur={() => void saveCompact()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </Field>
        {project?.root ? (
          <Field label="根目录">
            <div className="truncate text-[13px]" title={project.root}>
              {project.root}
            </div>
          </Field>
        ) : null}
      </div>

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
