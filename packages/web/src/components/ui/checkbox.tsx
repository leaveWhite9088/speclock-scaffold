import type { ReactNode } from 'react';

/** A tick box with its label. */
export function Checkbox({ checked, onChange, children, title }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px]" title={title}>
      <input type="checkbox" className="size-3.5 accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
