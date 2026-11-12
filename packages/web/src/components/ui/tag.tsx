import { cn } from '@/lib/utils';

/** CLI × LLM chip: who is running (coloured) and which model it uses. */
export function Tag({ type, llm, faint, className }: { type: string; llm?: string | null; faint?: boolean; className?: string }) {
  return (
    <span title={`${type} · ${llm || '默认模型'}`} className={cn('inline-flex min-w-0 max-w-full items-stretch overflow-hidden rounded-sm border border-line-2 text-[11.5px] leading-none', className)}>
      <span data-cli={type} className="cli-chip shrink-0 px-1.5 py-1 font-mono font-semibold">{type}</span>
      <span className={cn('min-w-0 truncate bg-raised px-[7px] py-1', faint ? 'text-muted' : 'text-ink-2')}>{llm || '默认模型'}</span>
    </span>
  );
}
