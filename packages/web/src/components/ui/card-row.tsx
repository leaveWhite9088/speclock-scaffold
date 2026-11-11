import type { ReactNode } from 'react';

/** One entry of a list: a name, a line under it, and its actions on the right. */
export function CardRow({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <li className="card flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{title}</div>
        {sub ? <div className="truncate text-[12.5px] text-muted">{sub}</div> : null}
      </div>
      {actions}
    </li>
  );
}
