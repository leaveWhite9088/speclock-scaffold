import { BookMarked, ExternalLink, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Resizer } from '@/components/ui/resizer';
import { useProject, useSpecsStatus } from '@/hooks/queries';
import { WIDTH_LIMITS, useUi } from '@/store';

/** What to tell when Core's page cannot be shown yet. */
function why(s: { found: boolean; built: boolean; setUp: boolean } | undefined): string {
  if (!s) return '正在连接…';
  if (!s.found || !s.built) return '还没有下载规格库。在项目根目录运行 npm run preflight -- core --yes（需要 git、uv 和 npm），然后重启 agentd。';
  if (!s.setUp) return '规格库还没有初始化：第一次给执行者选「规格角色」时会自动初始化并启动。';
  return '规格库没有在运行：它会随 agentd 启动，或在下次用到时自动拉起。';
}

/** SpecLock Core's own page, embedded: the spec library is browsed here, not re-built in this app. */
export function CoreDrawer() {
  const open = useUi((s) => s.core);
  const setCore = useUi((s) => s.setCore);
  const width = useUi((s) => s.widths.core);
  const setWidth = useUi((s) => s.setWidth);
  const project = useProject();
  const { data } = useSpecsStatus(open, project?.id ?? '');
  const [nonce, setNonce] = useState(0);
  if (!open) return null;
  // Core's page shows one project; the one on screen here is opened directly, so there is nothing to pick
  const src = data?.running && data.coreProjectId != null ? `${data.url}/?project=${data.coreProjectId}` : null;
  const [min, max] = WIDTH_LIMITS.core;
  return (
    <aside
      aria-label="规格库"
      onKeyDown={(e) => e.key === 'Escape' && setCore(false)}
      style={{ width }}
      className="surface relative m-2 ml-0 flex min-h-0 flex-col overflow-hidden max-[900px]:fixed max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-10 max-[900px]:ml-2 max-[900px]:!w-[92vw]"
    >
      <Resizer edge="left" label="调整规格库宽度" value={width} min={min} max={max} onChange={(v) => setWidth('core', v)} onReset={() => setWidth('core', null)} />
      <div className="flex min-h-[52px] items-center justify-between gap-2 border-b border-line py-2.5 pr-3 pl-5">
        <h2 className="m-0 flex min-w-0 items-center gap-2 text-[15px] font-semibold">
          <BookMarked className="size-4 shrink-0 text-muted" />
          规格库
          {data?.version ? <span className="text-[11.5px] font-normal text-muted">v{data.version}</span> : null}
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          {src ? (
            <>
              <IconButton label="刷新" onClick={() => setNonce((n) => n + 1)}>
                <RotateCw />
              </IconButton>
              <IconButton label="在新标签页打开" onClick={() => window.open(src, '_blank', 'noopener')}>
                <ExternalLink />
              </IconButton>
            </>
          ) : null}
          <Button size="icon" variant="ghost" aria-label="关闭规格库" onClick={() => setCore(false)}>
            <X className="size-4" />
          </Button>
        </div>
      </div>
      {src ? (
        <iframe key={`${nonce}-${src}`} title="SpecLock Core" src={src} className="min-h-0 w-full flex-1 border-0 bg-raised" />
      ) : (
        <p className="m-0 px-5 py-6 text-[13px] leading-relaxed text-muted">{data?.running && project ? `「${project.name ?? project.id}」在规格库里还没有位置：第一次给它的执行者选「规格角色」时会自动建好。` : why(data)}</p>
      )}
    </aside>
  );
}
