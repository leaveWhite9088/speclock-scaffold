import { ChevronRight } from 'lucide-react';
import { clock } from '@/lib/format';
import type { Item } from '@/lib/types';

type Report = Extract<Item, { kind: 'report' }>;

/**
 * The answers of tasks the dispatcher sent without waiting, as they reached it. Not something the person wrote, so it is
 * a quiet line (who came back and how), and open it for the message the dispatcher received.
 */
export function ReportLine({ item }: { item: Report }) {
  return (
    <details className="group -my-1 text-[12.5px] text-muted">
      <summary className="flex w-full min-w-0 cursor-pointer list-none items-center gap-1.5 py-0.5 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
        <span className="shrink-0">执行者回报</span>
        <span className="min-w-0 truncate">{item.heads.map((h) => h.replace(/ · 用时.*$/, '')).join('；')}</span>
        {item.at ? <span className="shrink-0">{clock(item.at)}</span> : null}
      </summary>
      <pre className="tint-block mt-0.5 ml-4">{item.text}</pre>
    </details>
  );
}
