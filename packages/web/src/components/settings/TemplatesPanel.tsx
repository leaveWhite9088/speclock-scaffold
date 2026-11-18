import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { DialogActions } from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useInstanceTypes, usePresets, useTemplates } from '@/hooks/queries';
import { api, enc } from '@/lib/api';
import { SPEC_ROLE_OPTIONS, slug } from '@/lib/format';
import type { Template } from '@/lib/types';

const EMPTY: Template = { id: '', name: '', role: '', dir: '.', type: '', model: '', spec: '', preset: '', prompt: '' };
const UNGROUPED = '__general__';

interface TemplateGroup {
  key: string;
  presetValue: string;
  label: string;
  items: Template[];
}

/** Executor templates grouped by scene preset and collapsed by default. */
export function TemplatesPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: templates = [], isPending } = useTemplates();
  const { data: presets = [] } = usePresets();
  const { data: types = [] } = useInstanceTypes();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [edit, setEdit] = useState<{ t: Template; isNew: boolean } | null>(null);
  const set = (patch: Partial<Template>) => setEdit((e) => (e ? { ...e, t: { ...e.t, ...patch } } : e));

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups: TemplateGroup[] = (() => {
    const byKey = new Map<string, Template[]>();
    for (const t of templates) {
      const k = t.preset?.trim() || UNGROUPED;
      const list = byKey.get(k) ?? [];
      list.push(t);
      byKey.set(k, list);
    }
    const ordered: TemplateGroup[] = [];
    for (const p of presets) {
      const items = byKey.get(p.id);
      if (items?.length) {
        ordered.push({ key: p.id, presetValue: p.id, label: p.name, items });
        byKey.delete(p.id);
      }
    }
    for (const [k, items] of byKey) {
      if (k === UNGROUPED) continue;
      ordered.push({ key: k, presetValue: k, label: k, items });
    }
    const general = byKey.get(UNGROUPED);
    if (general?.length) {
      ordered.push({ key: UNGROUPED, presetValue: '', label: '通用（不限场景）', items: general });
    }
    return ordered;
  })();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    try {
      const id = edit.isNew ? slug(edit.t.name, templates.map((x) => x.id), 'template') : edit.t.id;
      const savedPresetKey = edit.t.preset?.trim() || UNGROUPED;
      await api('PUT', `/api/templates/${enc(id)}`, { ...edit.t, id });
      setEdit(null);
      setOpen((prev) => new Set(prev).add(savedPresetKey));
      await qc.invalidateQueries({ queryKey: ['templates'] });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const remove = async (t: Template) => {
    const n = t.usedBy?.length ?? 0;
    if (!(await confirm({ title: `删除模板「${t.name}」？`, description: n ? `${n} 个执行者在用它` : undefined, confirmText: '删除', danger: true }))) return;
    try {
      await api('DELETE', `/api/templates/${enc(t.id)}`);
      await qc.invalidateQueries({ queryKey: ['templates'] });
      await qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      toast((err as Error).message);
    }
  };

  if (edit) {
    return (
      <form onSubmit={submit} className="grid gap-2.5">
        <Field label="名称">
          <Input required autoFocus value={edit.t.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="用途">
          <Input placeholder="调度器据此挑人" value={edit.t.role} onChange={(e) => set({ role: e.target.value })} />
        </Field>
        <Field label="目录">
          <Input required value={edit.t.dir} onChange={(e) => set({ dir: e.target.value })} />
        </Field>
        <Field label="CLI">
          <Select value={edit.t.type} onChange={(v) => set({ type: v })} options={[{ value: '', label: '不指定' }, ...types.map((t) => ({ value: t, label: t }))]} />
        </Field>
        <Field label="模型">
          <Input value={edit.t.model} onChange={(e) => set({ model: e.target.value })} />
        </Field>
        <Field label="适用场景">
          <Select
            value={edit.t.preset ?? ''}
            onChange={(v) => set({ preset: v })}
            options={[{ value: '', label: '通用（不限场景）' }, ...presets.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </Field>
        <Field label="规格角色">
          <Select value={edit.t.spec ?? ''} onChange={(v) => set({ spec: v as Template['spec'] })} options={SPEC_ROLE_OPTIONS} />
        </Field>
        <Field label="提示词" className="items-start">
          <Textarea mono className="h-60 resize-y" placeholder="## 写给这类执行者的规则" value={edit.t.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        </Field>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>取消</Button>
          <Button type="submit" variant="primary" disabled={!edit.t.name.trim() || !edit.t.dir.trim()}>
            保存
          </Button>
        </DialogActions>
      </form>
    );
  }

  return (
    <div className="grid gap-3">
      <ul className="m-0 grid list-none gap-2 p-0">
        {groups.map((g) => {
          const expanded = open.has(g.key);
          return (
            <li key={g.key} className="card">
              <div className="flex items-center gap-2 px-2.5 py-2">
                <button type="button" onClick={() => toggle(g.key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={expanded}>
                  <ChevronRight className={`size-3.5 shrink-0 text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
                  <span className="shrink-0 text-[13px] font-semibold">{g.label}</span>
                  <span className="rounded-sm border border-line-2 bg-side px-1.5 py-0.5 text-[11px] text-muted">{g.items.length}</span>
                  {!expanded ? (
                    <span className="min-w-0 truncate pl-0.5 text-[12.5px] text-muted">
                      {g.items.map((x) => x.name).join('、')}
                    </span>
                  ) : null}
                </button>
                <IconButton label={`在「${g.label}」下新建模板`} onClick={() => setEdit({ t: { ...EMPTY, preset: g.presetValue }, isNew: true })}>
                  <Plus />
                </IconButton>
              </div>
              {expanded ? (
                <ul className="m-0 grid list-none divide-y divide-line border-t border-line p-0">
                  {g.items.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 px-3 py-2 pl-7">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{t.name}</div>
                        {t.role ? <div className="truncate text-[12.5px] text-muted">{t.role}</div> : null}
                      </div>
                      <IconButton label="编辑" onClick={() => setEdit({ t, isNew: false })}>
                        <Pencil />
                      </IconButton>
                      <IconButton label="删除" className="hover:text-danger" onClick={() => void remove(t)}>
                        <Trash2 />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
        {!groups.length ? <Empty>{isPending ? '读取中…' : '还没有模板'}</Empty> : null}
      </ul>
      <div>
        <Button size="sm" onClick={() => setEdit({ t: EMPTY, isNew: true })}>
          ＋ 新建模板
        </Button>
      </div>
    </div>
  );
}
