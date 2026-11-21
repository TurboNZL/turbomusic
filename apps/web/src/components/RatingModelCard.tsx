import { useLibrary } from '../lib/derive.ts';
import { updateProfile } from '../lib/profile.ts';

const MODELS = [
  { id: 'preference', label: 'Preference fit (new)', text: 'Every vote you ever cast is weighed together. The order you voted in does not matter, an old “this beats that” keeps its weight, contradictions are settled by the evidence, and a song with few votes stays near the middle until its votes say otherwise. Thumbs add a small bonus behind the scenes. Ratings follow a bell curve with your best song as the 10.' },
  { id: 'elo', label: 'Classic Elo', text: 'Votes are replayed one at a time, each moving the two songs a little. Simple and familiar, but the top of the list moves with every vote and an old vote fades as new ones stack on it. Ratings are stretched between your worst (0) and best (10) song.' },
] as const;

/** Settings > Library: which maths turns your votes into ratings. Saved with the library, so it holds on every device. */
export function RatingModelCard() {
  const lib = useLibrary();
  const now = lib.profile?.settings?.ratingModel === 'elo' ? 'elo' : 'preference';
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">Your votes are never changed, only how they become ratings. You can switch back and forth: nothing is lost.</p>
      {MODELS.map((m) => (
        <label key={m.id} className="flex items-start gap-2">
          <input type="radio" name="rating-model" className="mt-0.5" checked={now === m.id} onChange={() => updateProfile(lib, (p) => ({ ...p, settings: { ...p.settings, ratingModel: m.id } }))} />
          <span><b>{m.label}</b><br /><span className="text-muted">{m.text}</span></span>
        </label>))}
    </div>
  );
}
