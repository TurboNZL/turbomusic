import './lib/legacyNames.ts'; // first: carries an old install's settings over before the store reads them
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import './index.css';
import './fonts.css';
import { applyAppearance } from './lib/appearance.ts';
import { startConnect } from './lib/connect.ts';
import { startSpotifySdkIfWanted } from './lib/spotifySdk.ts';
import { startSpotifyMirror } from './lib/spotifyMirror.ts';
import { startTermuxServerIfWanted } from './lib/termux.ts';
import { startPresence } from './lib/discordPresence.ts';
import { useStore } from './lib/store.ts';
import { startHaptics } from './lib/haptics.ts';
import { pairFromSearch } from './lib/pairCode.ts';
import { syncNativeServer } from './lib/native.ts';

// before the first paint, so a saved theme does not flash the default one
applyAppearance(useStore.getState().settings);
startConnect();
startSpotifySdkIfWanted();
startSpotifyMirror();
startTermuxServerIfWanted();
startHaptics();
startPresence();
// the Android app's car interface needs the server address too; the app's own page is served from a private address, so a blank URL means "this origin"
{
  let last = '';
  const push = (s: { serverUrl: string; token: string; cfAccessId: string; cfAccessSecret: string }) => { const k = `${s.serverUrl}|${s.token}|${s.cfAccessId}|${s.cfAccessSecret}`; if (k !== last) { last = k; syncNativeServer(s.serverUrl, s.token, { id: s.cfAccessId, secret: s.cfAccessSecret }); } };
  push(useStore.getState().settings);
  useStore.subscribe((st) => push(st.settings));
}

// a pairing link (/?pair=CUR1-...) connects this device to a server, after asking
{
  const p = pairFromSearch(location.search);
  if (new URLSearchParams(location.search).has('pair')) {
    if (p && confirm(`Connect this device to ${p.url || location.origin}?`)) useStore.getState().updateSettings({ serverUrl: p.url === location.origin ? '' : p.url, token: p.token, ...(p.access ? { cfAccessId: p.access.id, cfAccessSecret: p.access.secret } : {}) });
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);

// Offline app shell. Service workers need a secure origin (https or localhost); elsewhere this is skipped and the app still works online.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
