import { useState } from 'react';
import { GROUP_CHOICES, readMenuDefaults, writeMenuDefault } from '../lib/menuDefaults.ts';
import { ThemedSelect } from './ThemedSelect.tsx';

/** Settings: what pressing a menu group's row does (its flyout still lists everything). Saved on this device. */
export function MenuDefaultsCard() {
  const [now, setNow] = useState(readMenuDefaults);
  const set = (group: string, v: string) => { writeMenuDefault(group, v || null); setNow(readMenuDefaults()); };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">In a right-click or ⋯ menu, hovering a row with an arrow opens its items; pressing the row itself does one of them. Choose which.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {GROUP_CHOICES.map((g) => (
          <label key={g.group} className="space-y-1">{g.title}
            <ThemedSelect aria-label={`Pressing ${g.group} does`} value={now[g.group] ?? ''} onChange={(e) => set(g.group, e.target.value)}>
              <option value="">The usual one</option>
              {g.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </ThemedSelect></label>))}
      </div>
    </div>
  );
}
