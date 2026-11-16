import { useState } from 'react';
import { ArrowLeft, Loader2, Server, Smartphone, Sparkles } from 'lucide-react';
import { useStore } from '../lib/store.ts';
import { isAndroidApp } from '../lib/native.ts';
import { decodePairCode } from '../lib/pairCode.ts';
import { serverAppSupported } from '../lib/serverApp.ts';
import { ServerAppCard } from './ServerAppCard.tsx';

const KEY = 'turbomusic.onboarded';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ } };

/**
 * First run in the Android app: where does the music live? Connect to a server you already have (paste its pairing code, or its address and
 * token), run one on this phone, or look around first. Shown once, and only while the app has no server yet; Settings has all of it later.
 */
export function Onboarding() {
  const { settings, updateSettings, syncNow } = useStore();
  const [done, setDone] = useState(seen);
  const [step, setStep] = useState<'start' | 'connect' | 'phone'>('start');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done || !isAndroidApp() || settings.serverUrl) return null;
  const finish = () => { markSeen(); setDone(true); };

  const connect = async () => {
    setError(null);
    const pair = code.trim() ? decodePairCode(code.trim()) : null;
    if (code.trim() && !pair) { setError('That pairing code is not valid. Copy it again from Settings > Server > Pair a device on the other device.'); return; }
    const url = (pair?.url ?? address).trim().replace(/\/+$/, '');
    const tok = pair?.token ?? token.trim();
    if (!/^https?:\/\//.test(url)) { setError('The address starts with http:// or https://, for example http://192.168.1.20:47813.'); return; }
    setBusy(true);
    try {
      const headers: Record<string, string> = pair?.access ? { 'CF-Access-Client-Id': pair.access.id, 'CF-Access-Client-Secret': pair.access.secret } : {};
      const res = await fetch(`${url}/api/health`, { headers });
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      updateSettings({ serverUrl: url, token: tok, ...(pair?.access ? { cfAccessId: pair.access.id, cfAccessSecret: pair.access.secret } : {}) });
      void syncNow();
      finish();
    } catch (e) { setError(`Could not reach ${url}. ${(e as Error).message} Check the address, that the phone is on the same network (or has Tailscale), and that the server is running.`); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-bg p-5 pt-[max(1.25rem,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-label="Welcome to TurboMusic">
      <div className="mx-auto max-w-md space-y-5 py-6">
        {step === 'start' && <>
          <div className="space-y-1"><Sparkles className="text-accent" size={28} /><h1 className="text-2xl font-bold">Welcome to TurboMusic</h1>
            <p className="text-sm text-muted">Your library, your ratings and your listening history live on a server you own. Where should this phone find it?</p></div>
          <button className="card flex w-full items-start gap-3 p-4 text-left hover:bg-raised/50" onClick={() => setStep('connect')}>
            <Server className="mt-0.5 shrink-0 text-accent" size={20} /><span><b className="block">I already have a server</b><span className="text-sm text-muted">A Raspberry Pi, a PC or the desktop app. You only need its pairing code.</span></span></button>
          {serverAppSupported() && <button className="card flex w-full items-start gap-3 p-4 text-left hover:bg-raised/50" onClick={() => setStep('phone')}>
            <Smartphone className="mt-0.5 shrink-0 text-accent" size={20} /><span><b className="block">Run the server on this phone</b><span className="text-sm text-muted">Installs the small TurboMusic Server app. Good for trying it out, or if this phone is your only device.</span></span></button>}
          <button className="btn btn-ghost w-full" onClick={finish}>Look around first</button>
          <p className="text-center text-xs text-muted">You can change all of this later in Settings.</p>
        </>}
        {step === 'connect' && <>
          <button className="btn btn-ghost !px-2" onClick={() => { setStep('start'); setError(null); }}><ArrowLeft size={15} />Back</button>
          <h1 className="text-xl font-bold">Connect to your server</h1>
          <p className="text-sm text-muted">On a device that already works, open Settings &gt; Server &gt; Pair a device, copy the code and paste it here.</p>
          <label className="block space-y-1 text-sm"><span className="font-medium">Pairing code</span><textarea className="input min-h-20 font-mono text-xs" placeholder="CUR1-…" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <details className="text-sm"><summary className="cursor-pointer text-muted">No code? Type the address and token instead</summary>
            <div className="mt-2 space-y-2">
              <input className="input" placeholder="http://192.168.1.20:47813" inputMode="url" autoCapitalize="none" value={address} onChange={(e) => setAddress(e.target.value)} />
              <input className="input" placeholder="Access token" autoCapitalize="none" value={token} onChange={(e) => setToken(e.target.value)} /></div></details>
          {error && <div role="alert" className="rounded-theme bg-bad/15 p-3 text-sm text-bad">{error}</div>}
          <button className="btn btn-accent w-full" disabled={busy || (!code.trim() && !address.trim())} onClick={() => void connect()}>{busy && <Loader2 size={15} className="animate-spin" />}Connect</button>
        </>}
        {step === 'phone' && <>
          <button className="btn btn-ghost !px-2" onClick={() => setStep('start')}><ArrowLeft size={15} />Back</button>
          <h1 className="text-xl font-bold">Server on this phone</h1>
          <ServerAppCard />
          <button className="btn w-full" onClick={finish}>Done for now</button>
        </>}
      </div>
    </div>
  );
}
