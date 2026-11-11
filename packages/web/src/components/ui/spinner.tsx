import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Something is running: a small turning circle. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 role="status" aria-label="进行中" className={cn('size-3.5 animate-spin', className)} />;
}
