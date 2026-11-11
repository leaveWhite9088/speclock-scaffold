import type { ReactNode } from 'react';

/** What a list or a page says when there is nothing to show: one short line. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-[13px] text-muted">{children}</div>;
}
