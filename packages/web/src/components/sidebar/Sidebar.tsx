import { Settings } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { Dot } from '@/components/ui/dot';
import { useProjectsQuery } from '@/hooks/queries';
import { useUi } from '@/store';
import { NewMemberDialog } from '../member/NewMemberDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { MemberList } from './MemberList';
import { ProjectBar } from './ProjectBar';

function StatusBar() {
  const conn = useUi((s) => s.conn);
  const { data } = useProjectsQuery();
  const l = data?.limits;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] whitespace-nowrap text-muted">
      <Dot state={conn === 'on' ? 'on' : conn === 'off' ? 'off' : 'idle'} />
      <span>{conn === 'on' ? '已连接' : conn === 'off' ? '未连接' : '连接中'}</span>
      {l ? (
        <>
          <span className="size-0.5 shrink-0 rounded-full bg-muted" aria-hidden />
          <span className="shrink-0">进程 {l.alive}/{l.maxProcesses}</span>
        </>
      ) : null}
    </div>
  );
}

export function Sidebar() {
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <aside className="flex min-h-0 flex-col bg-side max-[620px]:max-h-[34vh]">
      <ProjectBar />
      <MemberList onNew={() => setCreating(true)} />
      <div className="mt-auto flex min-w-0 items-center gap-1.5 border-t border-line px-3 py-2">
        <IconButton label="设置" className="shrink-0" onClick={() => setSettings(true)}>
          <Settings />
        </IconButton>
        <StatusBar />
      </div>
      <NewMemberDialog open={creating} onOpenChange={setCreating} />
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </aside>
  );
}
