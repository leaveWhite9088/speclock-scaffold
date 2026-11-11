import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A form row: label on the left, control on the right. The label column is the same width in every form. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('grid grid-cols-[5.5em_minmax(0,1fr)] items-center gap-x-2 text-[13px] text-muted', className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}
