import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** A multi-line text field, same look as Input; `mono` for text that is code or markdown. */
export function Textarea({ className, mono, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return <textarea className={cn('field w-full resize-none px-2.5 py-2 leading-relaxed', mono && 'font-mono text-[12.5px]', className)} {...rest} />;
}
