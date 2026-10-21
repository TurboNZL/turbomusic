import { useState } from 'react';
import { ImageDown } from 'lucide-react';
import { drawShareCard, saveOrShare, type ShareCardSpec } from '../lib/shareCard.ts';

/** Draws the share picture for a recap and shares or saves it. */
export function ShareButton({ spec, name, label = 'Share picture' }: { spec: ShareCardSpec; name: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const go = async () => {
    setState('busy');
    try { await saveOrShare(await drawShareCard(spec), name); setState('done'); } catch { setState('error'); }
    setTimeout(() => setState('idle'), 2500);
  };
  return <button className="btn" onClick={go} disabled={state === 'busy'}><ImageDown size={15} />{state === 'done' ? 'Done' : state === 'error' ? 'Could not make it' : label}</button>;
}
