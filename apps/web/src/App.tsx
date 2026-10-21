import { useEffect } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { useStore } from './lib/store.ts';
import { HealthPage } from './pages/Health.tsx';
import { HomePage } from './pages/Home.tsx';
import { NotesPage } from './pages/NotesPage.tsx';
import { AlbumsPage } from './pages/Albums.tsx';
import { AlbumPage } from './pages/Album.tsx';
import { SinglesPage } from './pages/Singles.tsx';
import { ErasPage, EraPage } from './pages/Eras.tsx';
import { ArtistsPage } from './pages/Artists.tsx';
import { ArtistPage } from './pages/Artist.tsx';
import { TracksPage } from './pages/Tracks.tsx';
import { VotePage } from './pages/Vote.tsx';
import { NotePage } from './pages/NotePage.tsx';
import { QueuePage } from './pages/Queue.tsx';
import { PlaylistsPage } from './pages/Playlists.tsx';
import { SearchPage } from './pages/Search.tsx';
import { DiscoverPage } from './pages/Discover.tsx';
import { EntityStatsPage } from './pages/EntityStats.tsx';
import { RecapsPage } from './pages/Recaps.tsx';
import { WrappedPage } from './pages/Wrapped.tsx';
import { StatsPage } from './pages/Stats.tsx';
import { SettingsPage } from './pages/Settings.tsx';

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
