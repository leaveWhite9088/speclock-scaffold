import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CardRow } from '@/components/ui/card-row';
import { useConfirm } from '@/components/ui/confirm';
import { DialogActions } from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useInstanceTypes, useTemplates } from '@/hooks/queries';
import { api, enc } from '@/lib/api';
import { SPEC_ROLE_OPTIONS, slug } from '@/lib/format';
import type { Template } from '@/lib/types';

const EMPTY: Template = { id: '', name: '', role: '', dir: '.', type: '', model: '', spec: '', prompt: '' };

/** Executor templates: what an executor is for and the system prompt that makes it so. Stored as markdown files on the server. */
export function TemplatesPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: templates = [], isPending } = useTemplates();
  const { data: types = [] } = useInstanceTypes();
  const [edit, setEdit] = useState<{ t: Template; isNew: boolean } | null>(null);
  const set = (patch: Partial<Template>) => setEdit((e) => (e ? { ...e, t: { ...e.t, ...patch } } : e));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    try {
      const id = edit.isNew ? slug(edit.t.name, templates.map((x) => x.id), 'template') : edit.t.id;
      await api('PUT', `/api/templates/${enc(id)}`, { ...edit.t, id });
      setEdit(null);
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
        {templates.map((t) => (
          <CardRow
            key={t.id}
            title={t.name}
            sub={t.role}
            actions={
              <>
                <IconButton label="编辑" onClick={() => setEdit({ t, isNew: false })}>
                  <Pencil />
                </IconButton>
                <IconButton label="删除" className="hover:text-danger" onClick={() => void remove(t)}>
                  <Trash2 />
                </IconButton>
              </>
            }
          />
        ))}
        {!templates.length ? <Empty>{isPending ? '读取中…' : '还没有模板'}</Empty> : null}
      </ul>
      <div>
        <Button size="sm" onClick={() => setEdit({ t: EMPTY, isNew: true })}>
          ＋ 新建模板
        </Button>
      </div>
    </div>
  );
}
