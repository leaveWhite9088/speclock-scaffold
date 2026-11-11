import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between text-[12.5px] font-semibold">
      <span>{title}</span>
      {action}
    </div>
  );
}

/** The buttons under a draft-backed form, on the right: "undo" (only while there is something to undo) and the submit button. */
export function DraftActions({ dirty, valid, submitText, onUndo }: { dirty: boolean; valid: boolean; submitText: string; onUndo: () => void }) {
  return (
    <div className="mt-1 flex items-center justify-end gap-3">
      {dirty ? (
        <Button variant="link" onClick={onUndo}>
          撤销修改
        </Button>
      ) : null}
      <Button type="submit" variant="primary" className="px-4" disabled={!dirty || !valid}>
        {submitText}
      </Button>
    </div>
  );
}
