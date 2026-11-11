import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { IconButton } from './icon-button';

export const Dialog = RD.Root;

/** A dialog: the title and a close button on top, the content scrolls if it must. */
export function DialogContent({ title, className, children, ...rest }: { title: string } & Omit<ComponentProps<typeof RD.Content>, 'title'>) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <RD.Content
        className={cn('fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[min(460px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col surface', className)}
        {...rest}
      >
        <header className="flex items-center justify-between px-5 pt-4 pb-2">
          <RD.Title className="m-0 text-[15px] font-semibold">{title}</RD.Title>
          <RD.Close asChild>
            <IconButton label="关闭">
              <X />
            </IconButton>
          </RD.Close>
        </header>
        <RD.Description className="sr-only">{title}</RD.Description>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5">{children}</div>
      </RD.Content>
    </RD.Portal>
  );
}

/** The buttons at the bottom of a form, on the right. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex justify-end gap-2">{children}</div>;
}
