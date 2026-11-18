import { useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CardRow } from '@/components/ui/card-row';
import { useConfirm } from '@/components/ui/confirm';
import { DialogActions } from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { usePresets } from '@/hooks/queries';
import { api, enc } from '@/lib/api';
import { slug } from '@/lib/format';
import type { Preset } from '@/lib/types';

const EMPTY: Preset = {
  id: '',
  name: '',
  description: '',
  dispatcherPrompt: '',
  executorPrompt: '',
  builtIn: false,
  modified: false,
};

/** Global scene presets: base system prompts for a project's dispatcher and executors. */
export function PresetsPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: presets = [], isPending } = usePresets();
  const [edit, setEdit] = useState<{ p: Preset; isNew: boolean } | null>(null);
  const set = (patch: Partial<Preset>) => setEdit((e) => (e ? { ...e, p: { ...e.p, ...patch } } : e));

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['presets'] });
    await qc.invalidateQueries({ queryKey: ['projects'] });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    try {
      const id = edit.isNew
        ? slug(edit.p.name, presets.map((x) => x.id), 'preset').toLowerCase()
        : edit.p.id;
      await api('PUT', `/api/presets/${enc(id)}`, {
        id,
        name: edit.p.name,
        description: edit.p.description,
        dispatcherPrompt: edit.p.dispatcherPrompt,
        executorPrompt: edit.p.executorPrompt,
      });
      setEdit(null);
      await refresh();
      toast('场景预设已保存');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const reset = async (p: Preset) => {
    if (!(await confirm({ title: `恢复「${p.name}」为内置默认提示词？`, description: '你对该预设的修改将被清除，使用它的项目将在空闲时切换回内置规则。', confirmText: '恢复默认' }))) return;
    try {
      await api('POST', `/api/presets/${enc(p.id)}/reset`);
      await refresh();
      toast('已恢复默认');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const remove = async (p: Preset) => {
    const n = p.usedBy?.length ?? 0;
    if (n) {
      toast(`还有 ${n} 个项目正在使用该预设，请先切换项目预设后再删除`);
      return;
    }
    if (!(await confirm({ title: `删除预设「${p.name}」？`, confirmText: '删除', danger: true }))) return;
    try {
      await api('DELETE', `/api/presets/${enc(p.id)}`);
      await refresh();
      toast('预设已删除');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const duplicate = (p: Preset) => {
    setEdit({
      p: {
        ...p,
        id: '',
        name: `${p.name}（副本）`,
        builtIn: false,
        modified: false,
      },
      isNew: true,
    });
  };

  if (edit) {
    const valid = Boolean(edit.p.name.trim() && edit.p.dispatcherPrompt.trim() && edit.p.executorPrompt.trim());
    return (
      <form onSubmit={submit} className="grid gap-3">
        <Field label="名称">
          <Input required autoFocus value={edit.p.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="说明">
          <Input placeholder="一句话说明适用场景" value={edit.p.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label="调度器规则" className="items-start">
          <Textarea
            mono
            className="h-52 resize-y"
            placeholder="# 项目总调度器规则"
            value={edit.p.dispatcherPrompt}
            onChange={(e) => set({ dispatcherPrompt: e.target.value })}
          />
        </Field>
        <Field label="执行者底规" className="items-start">
          <Textarea
            mono
            className="h-44 resize-y"
            placeholder="# 执行者通用底规"
            value={edit.p.executorPrompt}
            onChange={(e) => set({ executorPrompt: e.target.value })}
          />
        </Field>
        <DialogActions>
          <Button onClick={() => setEdit(null)}>取消</Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            保存
          </Button>
        </DialogActions>
      </form>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-[12.5px] text-muted">
        每套场景预设包含「总调度器规则」与「执行者通用底规」两段底座提示词。新建项目或在项目的调度器设置中可随时切换场景，也可在单个项目内进一步追加或覆盖。
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {presets.map((p) => {
          const users = p.usedBy?.length ?? 0;
          return (
            <CardRow
              key={p.id}
              title={
                <span className="inline-flex items-center gap-1.5">
                  <span>{p.name}</span>
                  {p.builtIn ? (
                    <span className="rounded-sm border border-line-2 bg-side px-1.5 py-0.5 text-[11px] font-normal text-muted">
                      {p.modified ? '内置 · 已修改' : '内置'}
                    </span>
                  ) : null}
                  {users ? <span className="text-[11.5px] font-normal text-muted">{users} 个项目在用</span> : null}
                </span>
              }
              sub={p.description}
              actions={
                <>
                  <IconButton label="基于此预设复制新建" onClick={() => duplicate(p)}>
                    <Copy />
                  </IconButton>
                  <IconButton label="编辑" onClick={() => setEdit({ p, isNew: false })}>
                    <Pencil />
                  </IconButton>
                  {p.builtIn && p.modified ? (
                    <IconButton label="恢复内置默认" onClick={() => void reset(p)}>
                      <RotateCcw />
                    </IconButton>
                  ) : null}
                  {!p.builtIn ? (
                    <IconButton label="删除" className="hover:text-danger" onClick={() => void remove(p)}>
                      <Trash2 />
                    </IconButton>
                  ) : null}
                </>
              }
            />
          );
        })}
        {!presets.length ? <Empty>{isPending ? '读取中…' : '还没有预设'}</Empty> : null}
      </ul>
      <div>
        <Button size="sm" onClick={() => setEdit({ p: EMPTY, isNew: true })}>
          ＋ 新建场景预设
        </Button>
      </div>
    </div>
  );
}
