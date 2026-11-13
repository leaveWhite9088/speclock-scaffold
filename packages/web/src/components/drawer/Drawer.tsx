import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Resizer } from '@/components/ui/resizer';
import { useSelectedMember } from '@/hooks/queries';
import { WIDTH_LIMITS, useUi } from '@/store';
import { DispatcherSettings } from './DispatcherSettings';
import { ExecutorSettings } from './ExecutorSettings';

/** Settings of whoever is selected: the dispatcher's model and sessions, or an executor's config and sessions. */
export function Drawer() {
  const open = useUi((s) => s.drawer);
  const setDrawer = useUi((s) => s.setDrawer);
  const width = useUi((s) => s.widths.settings);
  const setWidth = useUi((s) => s.setWidth);
  const { project, member, isDispatcher } = useSelectedMember();
  if (!open || !project) return null;
  return (
    <aside
      aria-label="设置"
      onKeyDown={(e) => e.key === 'Escape' && setDrawer(false)}
      style={{ width }}
      className="surface relative m-2 ml-0 flex min-h-0 flex-col max-[900px]:fixed max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-10 max-[900px]:ml-2 max-[900px]:max-w-[92vw]"
    >
      <Resizer edge="left" label="调整设置栏宽度" value={width} min={WIDTH_LIMITS.settings[0]} max={WIDTH_LIMITS.settings[1]} onChange={(v) => setWidth('settings', v)} onReset={() => setWidth('settings', null)} />
      <div className="flex min-h-[52px] items-center justify-between py-2.5 pr-3.5 pl-5">
        <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold">
          <SlidersHorizontal className="size-4 text-muted" />
          {isDispatcher ? '调度器' : (member?.id ?? '')}
        </h2>
        <Button size="icon" variant="ghost" aria-label="关闭设置" onClick={() => setDrawer(false)}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="grid flex-1 content-start gap-5 overflow-y-auto px-5 pt-1 pb-6">
        {isDispatcher ? <DispatcherSettings key={project.id} projectId={project.id} /> : member ? <ExecutorSettings key={member.key} m={member} projectId={project.id} root={project.root} /> : null}
      </div>
    </aside>
  );
}
