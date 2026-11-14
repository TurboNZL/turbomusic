import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { useStore } from './lib/store.ts';
import { HomePage } from './pages/Home.tsx';
import { AlbumsPage } from './pages/Albums.tsx';
import { AlbumPage } from './pages/Album.tsx';
import { SinglesPage } from './pages/Singles.tsx';
import { ErasPage, EraPage } from './pages/Eras.tsx';
import { ArtistsPage } from './pages/Artists.tsx';
import { ArtistPage } from './pages/Artist.tsx';
import { TracksPage } from './pages/Tracks.tsx';
import { QueuePage } from './pages/Queue.tsx';
import { PlaylistsPage } from './pages/Playlists.tsx';
import { SearchPage } from './pages/Search.tsx';


// rarely-first pages load when first opened, so the app starts with less to parse
const HealthPage = lazy(() => import('./pages/Health.tsx').then((m) => ({ default: m.HealthPage })));
const NotesPage = lazy(() => import('./pages/NotesPage.tsx').then((m) => ({ default: m.NotesPage })));
const NotePage = lazy(() => import('./pages/NotePage.tsx').then((m) => ({ default: m.NotePage })));
const DiscoverPage = lazy(() => import('./pages/Discover.tsx').then((m) => ({ default: m.DiscoverPage })));
const EntityStatsPage = lazy(() => import('./pages/EntityStats.tsx').then((m) => ({ default: m.EntityStatsPage })));
const RecapsPage = lazy(() => import('./pages/Recaps.tsx').then((m) => ({ default: m.RecapsPage })));
const WrappedPage = lazy(() => import('./pages/Wrapped.tsx').then((m) => ({ default: m.WrappedPage })));
const StatsPage = lazy(() => import('./pages/Stats.tsx').then((m) => ({ default: m.StatsPage })));
const SettingsPage = lazy(() => import('./pages/Settings.tsx').then((m) => ({ default: m.SettingsPage })));
const VotePage = lazy(() => import('./pages/Vote.tsx').then((m) => ({ default: m.VotePage })));

export function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  useEffect(() => { void init(); }, [init]);
  if (!ready) return <div className="p-8 text-muted">Loading library…</div>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="notes/:id" element={<NotePage />} />
        <Route path="bios" element={<Navigate to="/notes" replace />} />
        <Route path="albums" element={<AlbumsPage />} />
        <Route path="albums/:id" element={<AlbumPage />} />
        <Route path="singles" element={<SinglesPage />} />
        <Route path="eras" element={<ErasPage />} />
        <Route path="eras/:id" element={<EraPage />} />
        <Route path="artists" element={<ArtistsPage />} />
        <Route path="artists/:id" element={<ArtistPage />} />
        <Route path="tracks" element={<TracksPage />} />
        <Route path="vote" element={<VotePage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="playlists" element={<PlaylistsPage />} />
        <Route path="playlists/:playlistId" element={<PlaylistsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="discover" element={<DiscoverPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="stats/:kind/:id" element={<EntityStatsPage />} />
        <Route path="recaps" element={<RecapsPage />} />
        <Route path="wrapped" element={<WrappedPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<div className="p-8 text-muted">Nothing here.</div>} />
      </Route>
    </Routes>
  );
}
