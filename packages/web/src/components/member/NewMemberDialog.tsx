import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogActions, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { RuntimeFields } from '@/components/drawer/RuntimeFields';
import { SPEC_ROLE_OPTIONS } from '@/lib/format';
import { useCatalog, useDirs, useInstanceTypes, useModelEffort, useProbeSessions, useProject, useProviders, useTemplates } from '@/hooks/queries';
import { api, enc } from '@/lib/api';
import { effortOptions, modelLabel, modelName, relDir, when } from '@/lib/format';
import { useUi } from '@/store';

const EMPTY = { id: '', type: '', dir: '', role: '', model: '', effort: '', provider: '', providerModel: '', sessionId: 'new', template: '', spec: '' };

export function NewMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const project = useProject();
  const select = useUi((s) => s.select);
  const [form, setForm] = useState(EMPTY);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const { data: types = [] } = useInstanceTypes();
  const { data: templates = [] } = useTemplates(open);
  const tpl = templates.find((t) => t.id === form.template);
  // A template fills in what it knows; everything stays editable.
  const pick = (id: string) => {
    const t = templates.find((x) => x.id === id);
    // The executor is named after the template (its display name, which is in Chinese for the presets) while it still has that name or none: a name the person typed stays.
    const autoName = form.id === '' || form.id === tpl?.name;
    if (!t) return set({ template: '', id: autoName ? '' : form.id });
    set({ template: id, id: autoName ? t.name : form.id, type: t.type && types.includes(t.type) ? t.type : form.type, dir: relDir(t.dir, project?.root), role: t.role, model: t.model, spec: t.spec ?? '', sessionId: 'new' });
  };
  const type = form.type || types[0] || '';
  const dir = relDir(form.dir, project?.root);
  const { data: dirs = [] } = useDirs(project?.id ?? '', open);
  const { data: catalog, isPending: modelsLoading } = useCatalog(open ? type : undefined);
  // The reasoning levels depend on the model: the default model's come with the model list, another model's are asked for.
  const providers = useProviders().data?.providers ?? [];
  const chosenModel = form.provider ? '' : form.model;
  const modelEffort = useModelEffort(open ? type : undefined, chosenModel);
  const providerReasons = form.provider ? providers.find((p) => p.id === form.provider)?.reasonings?.includes(form.providerModel) : true;
  const effortSource = !providerReasons ? null : chosenModel ? modelEffort.data : catalog?.effort;
  const effortLoading = chosenModel ? modelEffort.isPending : modelsLoading;
  // Listing sessions can start a CLI (10 s or more), so it loads on its own and never holds back the models.
  const { data: sessions, isPending: sessionsLoading, isError } = useProbeSessions(project?.id ?? "", type, dir, open);

  const known = ['./', ...dirs.map((d) => relDir(d))];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!project) return;
    try {
      await api('POST', `/api/projects/${enc(project.id)}/instances`, {
        id: form.id,
        type,
        dir,
        role: form.role || undefined,
        model: form.provider ? undefined : form.model || undefined,
        effort: form.effort || undefined,
        provider: form.provider ? { id: form.provider, model: form.providerModel } : undefined,
        sessionId: form.sessionId || 'new',
        template: form.template || undefined,
        // Always said outright: an empty choice must not fall back to the template's suggestion.
        spec: form.spec || 'none',
      });
      onOpenChange(false);
      setForm(EMPTY);
      toast('已创建，第一次用到时才会启动');
      await qc.invalidateQueries({ queryKey: ['projects'] });
      select(`${project.id}~${form.id}`);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="新建执行者">
        <form onSubmit={submit} className="grid gap-2.5">
          <Field label="模板">
            <Select value={form.template} onChange={pick} options={[{ value: '', label: '不使用模板' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} />
          </Field>
          <Field label="名称">
            <Input required autoFocus value={form.id} onChange={(e) => set({ id: e.target.value })} />
          </Field>
          <Field label="CLI">
            <Select value={type} onChange={(v) => set({ type: v, model: '', effort: '', provider: '', providerModel: '', sessionId: 'new' })} options={types.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="目录">
            <Input
              required
              list="member-dirs"
              placeholder="选已有目录，或填新的"
              value={form.dir}
              onChange={(e) => set({ dir: e.target.value, sessionId: 'new' })}
              onBlur={() => form.dir.trim() && set({ dir: relDir(form.dir, project?.root) })}
            />
            <datalist id="member-dirs">
              {known.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="用途">
            <Input placeholder="调度器据此挑人，例如 后端服务" value={form.role} onChange={(e) => set({ role: e.target.value })} />
          </Field>
          <Field label="规格角色">
            <Select value={form.spec} onChange={(v) => set({ spec: v })} options={SPEC_ROLE_OPTIONS} />
          </Field>
          {form.spec && <p className="-mt-1 pl-[6em] text-[12px] text-muted">创建时会在规格库里给它一把只属于这个项目的密钥，密钥不会出现在对话里。</p>}
          <RuntimeFields
            type={type}
            providerId={form.provider}
            providerModel={form.providerModel}
            onProvider={(id, model) => set({ provider: id, providerModel: model, effort: '' })}
            onProviderModel={(model) => set({ providerModel: model, effort: '' })}
            effort={{ value: form.effort, onChange: (v) => set({ effort: v }), disabled: effortLoading, options: effortOptions(effortSource?.options, effortSource?.current, form.effort) }}
            base={{
              value: form.model,
              onChange: (v) => set({ model: v, effort: '' }),
              options: [
                { value: '', label: modelsLoading ? '读取中…' : catalog?.default ? `默认（${modelName(catalog, catalog.default)}）` : '默认' },
                ...(catalog?.models ?? []).map((m) => ({ value: m.value, label: modelLabel(m.value, m.name) })),
              ],
            }}
          />
          <Field label="会话">
            <Select
             
              value={form.sessionId}
              onChange={(v) => set({ sessionId: v })}
              placeholder={sessionsLoading ? '读取中…' : undefined}
              options={[
                { value: 'new', label: '新建会话' },
                ...(isError ? [] : (sessions ?? []).map((s) => ({ value: s.sessionId, label: `${s.title || s.sessionId.slice(0, 8)}，${when(s.updatedAt)}` }))),
              ]}
            />
          </Field>
          <DialogActions>
            <Button onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" variant="primary" disabled={!project}>
              创建执行者
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
