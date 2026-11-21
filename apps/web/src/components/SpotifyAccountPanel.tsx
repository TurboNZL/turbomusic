import { useEffect, useState, type ReactNode } from 'react';
import { Copy, LogIn } from 'lucide-react';
import type { SpotifyHistoryStatus } from '../lib/api.ts';
import { api, useStore } from '../lib/store.ts';
import type { SpotifyDiagnosis } from '../lib/api.ts';
import { refreshSpotifyStatus } from '../lib/spotifyPlayer.ts';
import { Field } from './forms.tsx';
import { HistoryManager } from './HistoryManager.tsx';

type Status = { clientId: string; redirectUri: string; signedIn: boolean; streaming?: boolean; canWrite?: boolean; canHistory?: boolean; configured: boolean };

/** "Check the connection": what Spotify answers for this sign-in, in plain terms, for when devices or playlists do not load. */
function CheckConnection() {
  const [d, setD] = useState<SpotifyDiagnosis | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => { setBusy(true); setErr(null); try { setD(await api().spotifyDiagnose()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const line = (label: string, r?: { status: number; body?: string }, ok?: string) => r && <div><span className="text-muted">{label}:</span> {r.status >= 200 && r.status < 300 ? <span className="text-good">OK{ok ? ` (${ok})` : ''}</span> : <span className="text-bad">{r.status || 'no answer'} {r.body}</span>}</div>;
  return (
    <div className="space-y-1.5">
      <button className="btn btn-ghost !py-1 text-xs" disabled={busy} onClick={() => void run()}>{busy ? 'Checking…' : 'Check the connection'}</button>
      {err && <div className="text-xs text-bad">{err}</div>}
      {d && <div className="space-y-0.5 rounded-theme bg-raised p-2 font-mono text-xs">
        {d.refresh && <div className="text-bad">Refreshing the sign-in failed: {d.refresh}</div>}
        <div><span className="text-muted">Permissions held:</span> {d.permissions.length ? d.permissions.join(', ') : '(none recorded)'}</div>
        {line('Your account', d.me, d.me?.product ? `${d.me.product}${d.me.country ? `, ${d.me.country}` : ''}` : undefined)}
        {line('Device list', d.devices, d.devices?.devices ? (d.devices.devices.length ? d.devices.devices.join('; ') : 'no devices running') : undefined)}
        <div className="text-muted">App id starts with {d.clientIdStart || '(none)'}</div>
      </div>}
    </div>
  );
}

/**
 * Connecting TurboMusic's server to a Spotify account (Authorization Code with PKCE; the server holds the token). Used by Settings and by the
 * Spotify import. `children` shows once signed in.
 */
export function SpotifyAccountPanel({ children, onStatus }: { children?: (s: Status) => ReactNode; onStatus?: (s: Status) => void }) {
  const configured = useStore((s) => !!s.settings.token);
  const [acct, setAcct] = useState<Status | null>(null);
  const [clientId, setClientId] = useState('');
  const [redirect, setRedirect] = useState('');
  const [pasted, setPasted] = useState('');
  const [inApp, setInApp] = useState(false);
  const [write, setWrite] = useState(false);
  const [editApp, setEditApp] = useState(false);
  const [opened, setOpened] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = async (what: string, f: () => Promise<void>) => {
    setBusy(what); setError(null);
    try { await f(); } catch (e) { setError((e as Error).message === 'Failed to fetch' ? 'Cannot reach the server.' : (e as Error).message); } finally { setBusy(null); }
  };
  const load = () => guard('Checking…', async () => { const s = await api().spotifyStatus(); setAcct(s); setClientId(s.clientId); setRedirect(s.redirectUri); onStatus?.(s); void refreshSpotifyStatus(); });
  useEffect(() => { if (configured) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!configured) return <p className="text-sm text-muted">Spotify goes through your server. Connect one in Settings › Server first.</p>;
  if (!acct) return <div className="text-sm text-muted">{error ?? 'Checking…'}</div>;
  return (
    <div className="space-y-3 text-sm">
      {acct.signedIn ? (<>
        <div className="flex items-center gap-2"><span className="text-good">Signed in to Spotify.</span><button className="btn btn-ghost !py-1 text-xs" onClick={() => void guard('Signing out…', async () => { await api().spotifySignOut(); await load(); })}>Sign out</button></div>
        <CheckConnection />
        {!acct.canWrite && <div className="space-y-2 rounded-theme bg-raised p-2.5 text-xs text-muted">
          <div>TurboMusic can read your Spotify playlists but not change them. To send changes back from a synced playlist, allow it once.</div>
          <button className="btn !py-1 text-xs" disabled={!!busy} onClick={() => void guard('Opening Spotify…', async () => { window.open((await api().spotifyAuthUrl(acct.streaming ?? false, true, acct.canHistory ?? false)).url, '_blank', 'noopener'); setReauth(true); })}>Allow changing my playlists</button>
          {reauth && <div className="space-y-2"><Field label="Address Spotify sent you to"><input className="input font-mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://127.0.0.1:47813/api/spotify/callback?code=…" /></Field>
            <button className="btn" disabled={!pasted.trim() || !!busy} onClick={() => void guard('Connecting…', async () => { await api().spotifyExchange(pasted.trim()); setPasted(''); setReauth(false); await load(); })}>Connect</button></div>}
        </div>}
        <HistoryTracking acct={acct} guard={guard} busy={busy} reauth={reauth} setReauth={setReauth} pasted={pasted} setPasted={setPasted} reload={load} />
        {children?.(acct)}
      </>) : !acct.configured || editApp ? (<>
        {/* first, once: a free Spotify developer app, which is what lets TurboMusic sign in as you */}
        <div className="space-y-3 rounded-theme border border-line p-4">
          <div><div className="font-medium">Connect your Spotify account</div>
            <p className="text-muted">Spotify only lets an account sign in through an app you register yourself, and registering takes a minute. You do it once; every device that uses this server then shares it.</p></div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wider text-muted">Make the app</div>
            <p className="text-muted">Open <a className="text-accent underline" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a>, create an app (the account that owns it needs Premium), and give it this Redirect URI:</p>
            <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-theme bg-raised px-3 py-2 text-xs">{redirect || acct.redirectUri}</code>
              <button type="button" className="btn btn-ghost !p-2" aria-label="Copy the redirect address" onClick={() => void navigator.clipboard?.writeText(redirect || acct.redirectUri)}><Copy size={14} /></button></div>
          </div>
          <Field label="Then paste the app's Client ID"><input className="input font-mono" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="32 letters and digits" /></Field>
          <details className="text-xs text-muted"><summary className="cursor-pointer">Use a different redirect address</summary><div className="mt-2"><Field label="Redirect URI"><input className="input font-mono" value={redirect} onChange={(e) => setRedirect(e.target.value)} /></Field></div></details>
          <div className="flex gap-2"><button className="btn btn-accent" disabled={!clientId.trim() || !!busy} onClick={() => void guard('Saving…', async () => { setAcct(await api().spotifyConfig(clientId.trim(), redirect.trim() || undefined)); setEditApp(false); })}>Save and continue</button>
            {acct.configured && <button className="btn btn-ghost" onClick={() => setEditApp(false)}>Cancel</button>}</div>
        </div>
      </>) : (<>
        <div className="space-y-3 rounded-theme border border-line p-4">
          <div className="flex items-center gap-2"><div className="font-medium">Sign in to Spotify</div><button className="btn btn-ghost ml-auto !py-1 text-xs" onClick={() => setEditApp(true)}>Change the app</button></div>
          <p className="text-muted">Press the button, allow access, and Spotify sends you to an address (the page may show an error: that is fine). Copy that whole address and paste it below.</p>
          <div className="flex flex-wrap gap-2"><button className="btn btn-accent" disabled={!!busy} onClick={() => void guard('Opening Spotify…', async () => { window.open((await api().spotifyAuthUrl(inApp, write)).url, '_blank', 'noopener'); setOpened(true); })}><LogIn size={15} />Sign in with Spotify</button></div>
          {(opened || pasted) && <div className="space-y-2"><Field label="The address Spotify sent you to"><input className="input font-mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://127.0.0.1:47813/api/spotify/callback?code=…" /></Field>
            <button className="btn btn-accent" disabled={!pasted.trim() || !!busy} onClick={() => void guard('Connecting…', async () => { await api().spotifyExchange(pasted.trim()); setPasted(''); setOpened(false); await load(); })}>Connect</button></div>}
          <details className="text-xs text-muted"><summary className="cursor-pointer">Permissions</summary>
            <div className="mt-2 space-y-1.5">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={write} onChange={(e) => setWrite(e.target.checked)} />Allow changing my playlists (needed to send changes back to Spotify from a synced playlist; without it they only follow Spotify)</label>
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />Allow playing Spotify inside the app (browser player; asks for three more permissions, leave it off unless you want that)</label></div></details>
        </div>
      </>)}
      {busy && <div className="text-muted" role="status">{busy}</div>}
      {error && <div className="rounded-theme bg-bad/15 p-3 text-bad">{error}</div>}
    </div>
  );
}

const ago = (t: number | null) => { if (!t) return 'not yet'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

/**
 * Settings > Spotify: the server checks Spotify's "recently played" every quarter of an hour and adds new plays to your history, so Stats
 * keeps up with what you listen to on Spotify itself. It needs one more permission, asked only here. Plays are dropped when the same play
 * is also in an export file or in TurboMusic's own log.
 */
function HistoryTracking({ acct, guard, busy, reauth, setReauth, pasted, setPasted, reload }: { acct: Status; guard: (what: string, f: () => Promise<void>) => Promise<void>; busy: string | null; reauth: boolean; setReauth: (v: boolean) => void; pasted: string; setPasted: (v: string) => void; reload: () => Promise<void> | void }) {
  const [h, setH] = useState<SpotifyHistoryStatus | null>(null);
  const [asked, setAsked] = useState(false);
  const [manage, setManage] = useState(false);
  const refresh = () => api().spotifyHistory().then(setH, () => undefined);
  useEffect(() => { void refresh(); }, [acct.canHistory]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-2 rounded-theme border border-line p-3">
      <div className="flex flex-wrap items-center gap-2"><div className="font-medium">Track my Spotify plays automatically</div>
        {h?.enabled && <span className="chip !text-good">on</span>}</div>
      <p className="text-xs text-muted">Every 15 minutes your server asks Spotify what you played recently and adds the new plays to your listening history (one small request each time). Spotify only remembers the last 50 plays, which is plenty for that. Plays also found in an export you import later, or played through TurboMusic, are never counted twice.</p>
      {!acct.canHistory ? (<>
        <button className="btn !py-1 text-xs" disabled={!!busy} onClick={() => void guard('Opening Spotify…', async () => { window.open((await api().spotifyAuthUrl(acct.streaming ?? false, acct.canWrite ?? false, true)).url, '_blank', 'noopener'); setAsked(true); setReauth(true); })}>Allow reading my recently played</button>
        {asked && reauth && <div className="space-y-2"><Field label="Address Spotify sent you to"><input className="input font-mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://127.0.0.1:47813/api/spotify/callback?code=…" /></Field>
          <button className="btn" disabled={!pasted.trim() || !!busy} onClick={() => void guard('Connecting…', async () => { await api().spotifyExchange(pasted.trim()); setPasted(''); setReauth(false); setAsked(false); await reload(); })}>Connect</button></div>}
      </>) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!h?.enabled} disabled={!!busy} onChange={(e) => void guard(e.target.checked ? 'Turning on…' : 'Turning off…', async () => { setH(await api().spotifyHistoryEnable(e.target.checked)); })} />Check automatically</label>
          <button className="btn !py-1 text-xs" disabled={!!busy} onClick={() => void guard('Checking…', async () => { setH(await api().spotifyHistoryCheck()); })}>Check now</button>
        </div>)}
      {h && (h.enabled || h.lastCheck) && <p className="text-xs text-muted">Last check: {ago(h.lastCheck)}{h.lastCheck && !h.lastError ? ` · ${h.lastAdded} new` : ''} · {h.added.toLocaleString()} plays added so far{h.lastError ? '' : ''}</p>}
      {h?.lastError && <p className="text-xs text-bad">The last check failed: {h.lastError}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1"><button className="btn !py-1 text-xs" onClick={() => setManage(true)}>Manage imported history…</button><span className="text-xs text-muted">Hide ASMR, an old account or anything else that does not belong, from everything.</span></div>
      {manage && <HistoryManager onClose={() => setManage(false)} />}
    </div>
  );
}
