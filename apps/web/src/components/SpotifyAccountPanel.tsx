import { useEffect, useState, type ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { api, useStore } from '../lib/store.ts';
import type { SpotifyDiagnosis } from '../lib/api.ts';
import { refreshSpotifyStatus } from '../lib/spotifyPlayer.ts';
import { Field } from './forms.tsx';

type Status = { clientId: string; redirectUri: string; signedIn: boolean; streaming?: boolean; canWrite?: boolean; configured: boolean };

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
          <button className="btn !py-1 text-xs" disabled={!!busy} onClick={() => void guard('Opening Spotify…', async () => { window.open((await api().spotifyAuthUrl(acct.streaming ?? false, true)).url, '_blank', 'noopener'); setReauth(true); })}>Allow changing my playlists</button>
          {reauth && <div className="space-y-2"><Field label="Address Spotify sent you to"><input className="input font-mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://127.0.0.1:47813/api/spotify/callback?code=…" /></Field>
            <button className="btn" disabled={!pasted.trim() || !!busy} onClick={() => void guard('Connecting…', async () => { await api().spotifyExchange(pasted.trim()); setPasted(''); setReauth(false); await load(); })}>Connect</button></div>}
        </div>}
        {children?.(acct)}
      </>) : (<>
        <ol className="list-decimal space-y-1 pl-5 text-muted"><li>Make an app at <b>developer.spotify.com/dashboard</b> (free; Spotify requires Premium for the account that owns it). Set its Redirect URI to the address below exactly.</li>
          <li>Paste the app's <b>Client ID</b> here and save.</li><li>Press <b>Sign in with Spotify</b>, allow access, and copy the address Spotify sends you to (the page may show an error: that is fine, copy the whole address).</li><li>Paste it below.</li></ol>
        <div className="grid gap-2 sm:grid-cols-2"><Field label="Client ID"><input className="input font-mono" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="32 letters and digits" /></Field>
          <Field label="Redirect URI"><input className="input font-mono" value={redirect} onChange={(e) => setRedirect(e.target.value)} /></Field></div>
        <div className="flex flex-wrap gap-2"><button className="btn" disabled={!clientId.trim() || !!busy} onClick={() => void guard('Saving…', async () => setAcct(await api().spotifyConfig(clientId.trim(), redirect.trim() || undefined)))}>Save</button>
          <button className="btn btn-accent" disabled={!acct.configured || !!busy} onClick={() => void guard('Opening Spotify…', async () => { window.open((await api().spotifyAuthUrl(inApp, write)).url, '_blank', 'noopener'); })}><LogIn size={15} />Sign in with Spotify</button></div>
        <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" className="mt-0.5" checked={inApp} onChange={(e) => setInApp(e.target.checked)} />Also allow playing Spotify inside the app (browser player). Leave this off unless you want that: it asks Spotify for three more permissions.</label>
        <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" className="mt-0.5" checked={write} onChange={(e) => setWrite(e.target.checked)} />Also allow changing my playlists (needed to send changes back to Spotify from a synced playlist; without it synced playlists can only read from Spotify)</label>
        <Field label="Address Spotify sent you to"><input className="input font-mono" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://127.0.0.1:47813/api/spotify/callback?code=…" /></Field>
        <button className="btn" disabled={!pasted.trim() || !!busy} onClick={() => void guard('Connecting…', async () => { await api().spotifyExchange(pasted.trim()); setPasted(''); await load(); })}>Connect</button>
      </>)}
      {busy && <div className="text-muted" role="status">{busy}</div>}
      {error && <div className="rounded-theme bg-bad/15 p-3 text-bad">{error}</div>}
    </div>
  );
}
