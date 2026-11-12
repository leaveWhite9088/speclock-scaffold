import type { KeyboardEvent, PointerEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * A thin handle on the edge of a pane: drag to resize, arrow keys too, double-click to go back to the default.
 * `edge` is the side of the pane it sits on: on the "right" edge dragging right widens the pane, on the "left" edge dragging left does.
 * It uses pointer capture, so a drag keeps working over an iframe.
 */
export function Resizer({ edge, value, min, max, onChange, onReset, label }: { edge: 'left' | 'right'; value: number; min: number; max: number; onChange: (v: number) => void; onReset?: () => void; label: string }) {
  const sign = edge === 'right' ? 1 : -1;
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const start = value;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (m: globalThis.PointerEvent) => onChange(clamp(start + sign * (m.clientX - startX)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') onChange(clamp(value - sign * step));
    else if (e.key === 'ArrowRight') onChange(clamp(value + sign * step));
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={down}
      onKeyDown={key}
      onDoubleClick={onReset}
      className={cn('group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none max-[900px]:hidden', edge === 'right' ? '-right-1' : '-left-1')}
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60 group-active:opacity-90" />
    </div>
  );
}
