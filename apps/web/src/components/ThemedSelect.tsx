import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Select, type SelectOption } from './Select.tsx';
import { cn } from '../lib/cn.ts';

const text = (n: ReactNode): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : isValidElement(n) ? text((n.props as { children?: ReactNode }).children) : '');

/**
 * A drop-in for a native `<select>` that draws the list with the UI style (a native one opens the operating system's own list, which no
 * theme can touch). It takes the same `<option>` children and calls `onChange` with an object shaped like the event
 * (`e.target.value`), so converting a select is a matter of renaming the tag.
 */
export function ThemedSelect({ children, value, onChange, className, disabled, id, 'aria-label': ariaLabel }: {
  children: ReactNode; value: string | number; onChange?: (e: { target: { value: string } }) => void; className?: string; disabled?: boolean; id?: string; 'aria-label'?: string; title?: string;
}) {
  const options: SelectOption[] = [];
  for (const c of Children.toArray(children)) {
    if (!isValidElement(c)) continue;
    const el = c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
    const v = el.props.value ?? text(el.props.children);
    options.push({ value: String(v), label: text(el.props.children), disabled: el.props.disabled });
  }
  // an `input` class on a select gave it the field look; the Select button already has it, so only layout classes (width, padding, text size) are carried over
  const layout = (className ?? '').split(/\s+/).filter((c) => c && c !== 'input').join(' ');
  return <span id={id} className="inline-block max-w-full"><Select value={String(value)} options={options} disabled={disabled} aria-label={ariaLabel} className={cn(layout)} onChange={(v) => onChange?.({ target: { value: v } })} /></span>;
}
