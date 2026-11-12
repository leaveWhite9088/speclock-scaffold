import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Put `text` on the clipboard: the async API where the page may use it, else a hidden field and the old command. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.append(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    field.remove();
    return ok;
  }
}

/** A small button that copies `text`, and says so for a moment (the icon becomes a tick). */
export function CopyButton({ text, label = '复制', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      title={done === false ? '复制失败' : done ? '已复制' : label}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault(); // inside a <summary> a click would also fold the block
        e.stopPropagation();
        void copyText(text).then((ok) => {
          setDone(ok);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(null), 1500);
        });
      }}
      className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-ink focus-visible:opacity-100', done && 'text-ok hover:text-ok', done === false && 'text-danger', className)}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
