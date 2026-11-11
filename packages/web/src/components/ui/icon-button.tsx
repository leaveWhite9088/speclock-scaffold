import type { ComponentProps } from 'react';
import { Button } from './button';

/** A button that is only an icon; `label` is its tooltip and its name for screen readers. */
export function IconButton({ label, size = 'iconSm', ...rest }: { label: string } & Omit<ComponentProps<typeof Button>, 'title' | 'aria-label'>) {
  return <Button variant="ghost" size={size} title={label} aria-label={label} {...rest} />;
}
