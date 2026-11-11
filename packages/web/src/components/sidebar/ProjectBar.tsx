import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Ellipsis, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Empty } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/toast';
import { useProject, useProjectsQuery } from '@/hooks/queries';
import { useForceable } from '@/hooks/useForceable';
import { api, enc } from '@/lib/api';
import { slug } from '@/lib/format';
import { useUi } from '@/store';

type Open = 'list' | 'new' | 'menu' | null;

/**
 * Project switcher, new-project form and project actions. One `open` value drives all three,
 * so opening one closes the others (and a click anywhere else closes it).
 */
export function ProjectBar() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const forceable = useForceable();
  const { data } = useProjectsQuery();
  const project = useProject();
  const setProject = useUi((s) => s.setProject);
  const [open, setOpen] = useState<Open>(null);
  const [form, setForm] = useState({ name: '', root: '' });
  const bind = (which: Exclude<Open, null>) => ({ open: open === which, onOpenChange: (o: boolean) => setOpen(o ? which : null) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['projects'] });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const id = slug(form.name, data?.projects.map((p) => p.id), 'project');
      await api('POST', '/api/projects', { id, name: form.name.trim(), root: form.root.trim() });
      setForm({ name: '', root: '' });
      setOpen(null);
      await refresh();
      setProject(id);
      toast('项目已创建');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const stop = async () => {
    setOpen(null);
    if (!project || !(await confirm({ title: `关闭项目「${project.name}」？`, confirmText: '关闭' }))) return;
    try {
      if (await forceable('关闭项目', (force) => api('POST', `/api/projects/${enc(project.id)}/stop`, { force }))) {
        toast('项目已关闭');
        await refresh();
      }
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const remove = async () => {
    setOpen(null);
    if (!project || !(await confirm({ title: `删除项目「${project.name}」的配置？`, confirmText: '删除', danger: true }))) return;
    try {
      if (await forceable('删除项目', (force) => api('DELETE', `/api/projects/${enc(project.id)}${force ? '?force=1' : ''}`))) {
        toast('项目已删除');
        setProject('');
        await refresh();
      }
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <div className="flex items-center gap-0.5 px-3 pt-3 pb-1.5">
      <Popover {...bind('list')}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="none" className="h-[30px] min-w-0 flex-1 justify-start gap-1 px-2 text-[15px] font-semibold" title="切换项目">
            <span className="truncate">{project?.name ?? '还没有项目'}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="max-h-[60vh] w-60 overflow-y-auto" role="listbox">
          {data?.projects.length ? (
            data.projects.map((p) => (
              <MenuItem
                key={p.id}
                role="option"
                aria-selected={p.id === project?.id}
                onClick={() => {
                  setOpen(null);
                  if (p.id !== project?.id) setProject(p.id);
                }}
              >
                {p.name}
              </MenuItem>
            ))
          ) : (
            <Empty>还没有项目</Empty>
          )}
        </PopoverContent>
      </Popover>

      <Popover {...bind('new')}>
        <PopoverTrigger asChild>
          <Button size="icon" variant="ghost" title="新建项目" aria-label="新建项目">
            <Plus className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2.5">
          <form onSubmit={create} className="grid gap-2">
            <Input autoFocus placeholder="名称" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="根目录" required value={form.root} onChange={(e) => setForm({ ...form, root: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(null)}>取消</Button>
              <Button type="submit" variant="primary">
                创建项目
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      <Popover {...bind('menu')}>
        <PopoverTrigger asChild>
          <Button size="icon" variant="ghost" title="项目操作" aria-label="项目操作" disabled={!project}>
            <Ellipsis className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40">
          <MenuItem onClick={() => void stop()}>
            关闭项目
          </MenuItem>
          <MenuItem className="text-danger" onClick={() => void remove()}>
            删除项目
          </MenuItem>
        </PopoverContent>
      </Popover>
    </div>
  );
}
