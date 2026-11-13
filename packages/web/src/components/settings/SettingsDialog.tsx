import * as RD from '@radix-ui/react-dialog';
import { FileText, KeyRound, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ProvidersPanel } from './ProvidersPanel';
import { TemplatesPanel } from './TemplatesPanel';

interface Section {
  id: string;
  label: string;
  icon: ReactNode;
  panel: () => ReactNode;
}

/** The pages of the settings; a new one is one more entry here. */
const SECTIONS: Section[] = [
  { id: 'providers', label: '供应商', icon: <KeyRound className="size-4" />, panel: ProvidersPanel },
  { id: 'templates', label: '执行者模板', icon: <FileText className="size-4" />, panel: TemplatesPanel },
];

/** Settings: a fixed-size window with the pages on the left and the page on the right (it scrolls inside, the window never changes size). */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [id, setId] = useState(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
  const Panel = section.panel;
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RD.Content className="fixed top-1/2 left-1/2 z-50 grid h-[min(760px,92vh)] w-[min(1000px,94vw)] -translate-x-1/2 -translate-y-1/2 grid-cols-[200px_minmax(0,1fr)] overflow-hidden surface p-0 max-[620px]:grid-cols-[120px_minmax(0,1fr)]">
          <nav className="flex min-h-0 flex-col gap-0.5 border-r border-line bg-side p-3">
            <RD.Title className="m-0 mb-2 px-2 text-[15px] font-semibold">设置</RD.Title>
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" onClick={() => setId(s.id)} className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-hover', s.id === id && 'bg-hover font-medium text-ink')}>
                <span className="grid shrink-0 place-items-center">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </nav>
          <section className="flex min-h-0 flex-col">
            <header className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="m-0 text-[15px] font-semibold">{section.label}</h2>
              <RD.Close className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink" aria-label="关闭">
                <X className="size-4" />
              </RD.Close>
            </header>
            <RD.Description className="sr-only">{section.label}</RD.Description>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5">
              <Panel />
            </div>
          </section>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
