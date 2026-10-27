# TurboMusic

A personal music library manager for one person who owns their music files and cares about **ranking and curating** them. It keeps your library (artists, albums, releases, tracks, playlists, eras, notes) and ranks your tracks by asking one simple question over and over: *which of these two is better?*

Your answers become an Elo score for every track, shown as a 0–10 rating. Playback follows rules you define ("always play B right after A"), and everything keeps working offline.

It runs as a **web app** (desktop and phone browsers, installable as a PWA), as a **desktop app** (Electron, with the server built in) and as an **Android app** (with Android Auto), all talking to one small **server** that can live on a Raspberry Pi with an external drive. Each client is local first: it holds the whole library itself and syncs when a server is reachable.

> **Status: feature complete.** Everything planned has been built and is in daily use; what remains is fixing what real use turns up. The parts that could only be checked against fakes (real YouTube, Spotify, Cloudflare and the Android build) are listed under [what is unverified](#whats-unverified).

> The original app (generated with Dyad) has been **removed** from the repository; it survives in the git history, in the migration tool for its database and in the *Standard v1* UI style and colours (see [Appearance](#appearance)). Everything described here is the code in `packages/` and `apps/`.

## Run the server (one folder, no root)
```
curl -fsSL https://raw.githubusercontent.com/TurboNZL/turbomusic/main/scripts/install-server.sh | bash -s -- --root /mnt/data/turbomusic
```
Everything (the program, its own Node, ffmpeg, yt-dlp and the library) lives in that one folder; nothing is installed system-wide. It starts at boot as your own user service and updates from **Settings → Update server**. Moving an existing server: [docs/guides/MIGRATE_SERVER.md](docs/guides/MIGRATE_SERVER.md).

## Start here

**[docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md)** is the plain-language way in: install the desktop app (nothing else needed), or set up a home server on a Raspberry Pi with one command. Every guide in `docs/` is also readable inside the app (Settings → Guides).

## What it does

**Ranking**
- **Head-to-head votes.** "Which is better?" shows two tracks; you pick one, call them equal, or skip. By default only tracks that have audio are used (a checkbox turns that off; changing it keeps the pair on screen unless it holds a track without audio). Each card buffers a 15-second mid-track preview as soon as the pair appears and says "Loading preview…" until it can start at once. Keyboard: ← or → previews that side and the same arrow again picks it, ↑ skips, ↓ is equal. On a touch screen swipe a card right to pick it.
- **Questions on the home page** (*Sharpen your ranking*): head-to-head duels between near-equal tracks, “best of three”, “does this clear your top 10%?” and a love-it/not-really gut check, each chosen to move the ranking as much as possible and recorded as ordinary votes.
- **Thumbs up/down** in the player is a half-weight vote for the playing track. Votes are an append-only log; Elo, comparison counts and the 0–10 rating are *derived* by replaying it, so voting from several devices merges cleanly.

**Library**
- **Hierarchy:** Era (a collection of albums and singles, e.g. a phase of an artist) › Album › Release (a specific edition, with its own cover, date and tracklist) › Track. Singles are tracks on no album, with their own cover. Each album has a cover pool and a default release.
- **Credits are the artist.** There is no "artist" field: the *Lead artist* credit is the artist; producer, writer, featured and any role you invent are credits too. An album's credits, genres and cover flow down to its tracks until you change them.
- **One toolbar on every list** (Artists, Albums, Eras, Tracks, Singles): search with Discord-style chips (`artist:`, `album:`, `era:`, `genre:`, `tag:`, `before:`, `after:`, `rating:`, `has:`; each page offers the ones that make sense for it), a sort column with direction, and a covers/list switch, remembered per page. Playlists show a Spotify-style 2×2 mosaic of their first covers, and can hold whole albums.
- **Library health** finds missing covers, links, dates and lead credits and fixes them in bulk: *Find dates automatically* (from another release of the album, Spotify, iTunes, MusicBrainz), *Find YouTube Music albums* (the server runs YouTube Music's own album search for “artist album”, one album at a time, and you import the match as a release), **dead YouTube links** (videos YouTube says are gone are listed and not retried), and **Merge duplicate tracks** (the single and the album version of one song become one track that keeps every Spotify link, vote and play; “Not duplicates” hides a group for good). Releases are named from a reusable list of names (pick one or create it, like an artist; blank means the album's name), one release can be merged into another, and an album with a single release can be moved into another album as a release of it.
- **Notes:** write-ups tied to any number of artists, albums, tracks, releases, eras or playlists, with categories you make yourself, shown on each entity's page. A journal on the home page records what you did.

**Playback**
- A real queue (play next, add, reorder, shuffle that keeps rule pairs together), playback rules (a rule can also set its own crossfade for one pair of songs), a crossfade slider, play history per track, a ten-band equaliser, media keys and lock-screen controls. The next track is fetched while the current one plays, so changes are instant even through a tunnel, and the play button shows a spinner while a track loads. A full-screen **now-playing view** shows the cover over a blurred copy of itself with synced lyrics (from the free LRCLIB database, fetched by your server) and a screensaver mode with a drifting cover.
- **Play on a device:** every device using your server appears in the player, together with your **Spotify devices**; move playback to another one or use this one as its remote ([docs/guides/CONNECT.md](docs/guides/CONNECT.md)). Spotify tracks without a file play through Spotify, and the server can install and run Spotify's **Soloist** itself so no other Spotify app has to be open ([docs/development/SPOTIFY_NOTES.md](docs/development/SPOTIFY_NOTES.md)).
- **Offline:** keep any album or playlist's audio on the device, within a storage limit you set.

**Getting music in**
- Import a whole album from a YouTube / YouTube Music link (a release made this way starts with the album's date when one is known, and can be merged into a release you already have) (yt-dlp on the server, with cover art), add audio files from your device, or add tracks by hand. The server can download missing audio for tracks that have a YouTube link, with a progress bar for each song downloading. Imports fill in what they can (the artist, its usual genres, a cleaned title, the release date and cover).
- **Listening history** from Spotify (the extended streaming history, a zip or json) can be imported, and exported again in Spotify's own format, split per year into files under 11.8 MiB, with every play shown in a track's history.
- Backup and restore of the database and files from Settings, and a one-time migration from a legacy database.

**Running the server**
- **Server health** in Settings (free space on every disk, CPU temperature and load, memory, power, disk speed), **storage locations** (move the library files, temp folder and yt-dlp cache off the SD card while it runs), a button to copy the access token, and **Pair a device** (a code or link that sets up another device with the server address, access token and Cloudflare Access service token).

## The apps

| App | What it is | Guide |
|---|---|---|
| **Web** (`apps/web`) | Vite + React 19 + Tailwind 3 + zustand + IndexedDB. Served by the server at `/`, or from the dev server. Installable as a PWA on https or localhost. | below |
| **Windows server** (`apps/electron/src/serverEdition`) | The library server as a tray program for Windows: a setup wizard picks the folders for the database, music, downloads and cache, explains the Spotify options and sets up an optional Cloudflare tunnel. Low memory, no window while it runs. | [docs/guides/WINDOWS_SERVER.md](docs/guides/WINDOWS_SERVER.md) |
| **Desktop** (`apps/electron`) | The web client in its own window with the server inside it (`127.0.0.1:47814`), the library in a folder you choose. Media keys, Discord "listening to", self-update, and it says in Settings whether the GPU is painting the window. Windows and Linux installers. | [docs/development/ELECTRON.md](docs/development/ELECTRON.md) |
| **Android** (`apps/android`) | The web client in a WebView plus a native Media3 service so **Android Auto** can browse and play the library; updates itself from GitHub releases. Never compiled in the sandbox that wrote it: CI is the first real build. | [docs/development/ANDROID.md](docs/development/ANDROID.md) |
| **Server** (`packages/server`) | Hono + `node:sqlite` (no native build), meant for a Raspberry Pi. Sync API, content-addressed audio and image storage with HTTP range, yt-dlp import and download, backup, Play-on-a-device relay. Token auth. | [docs/guides/DEPLOY_PI.md](docs/guides/DEPLOY_PI.md) |
| **Core** (`packages/core`) | Pure TypeScript shared by all of them: ids (UUIDv7), Elo and vote replay, queue and playback rules, the sync record and its merge rule, entity shapes. | |

**Sync model.** Every row is a record `{table, id, updatedAt, deviceId, deleted, data}`. The server hands out an increasing sequence number; clients pull from their last cursor and push their outbox. The newest `updatedAt` wins (a tie goes to the higher `deviceId`); deletes are tombstones; votes, play logs and journal entries are append-only. Files are immutable and addressed by SHA-256, and records refer to files by hash, never by path.

## Appearance

Settings → Appearance has two independent choices with a live preview you can hover through:

- **Match this device** (the default for new installs): picks the look of the device you are on: Windows 11, macOS, iOS palette on iPhones and iPads, Material on Android and Chromebooks, Samsung One UI on Galaxy phones, KDE Breeze, Yaru on Ubuntu (desktop app) or GNOME on other Linux; light or dark follows the device. Choose anything else to override it.
- **Colour theme:** *Standard v2* (the app's own look, formerly "Default"), *Classic*, *Light*, *System*, 17 more themes (Daylight, Sand, Slate, Midnight, Ocean, Forest, Plum, Crimson, Ember, Graphite, AMOLED black, Nord, Dracula, Mocha, Tokyo Night, Gruvbox, Solarized), palettes copied from real systems (Adwaita, Breeze, Yaru, Windows 11/10/7/XP/98, macOS, iOS, Mac OS X Aqua, Android Holo, Winamp, LG Marshmallow, Fortnite chapters 1–6, Material You) and apps and games (Spotify, YouTube Music, Discord, Samsung One UI, Ado, Pip-Boy, Persona, Game Boy, Zune, Cyberpunk, Minecraft Bedrock), plus **Standard v1**, the first version's colours.
- **UI style:** shape, type, depth and motion: Standard v2, GTK 4, KDE Breeze, Yaru, Windows 11 / 10 / 7 / XP / 98, macOS, macOS Liquid Glass (real refraction in Chromium and Electron), Mac OS X Aqua, Android Holo, Winamp 2, LG Marshmallow (with squishy candy app icons), Samsung One UI, Spotify, YouTube Music, Discord, Ado, Fortnite Ch 1 / 2–3 / 4 / 5–6, Pip-Boy, Persona 5, Game Boy, Zune HD, Cyberpunk, Minecraft (Bedrock), Material 3 and **Standard v1** (the first version's look). "Use matching colours" pairs a style with its palette.
- **Layout:** where the pages are listed, separate from the look so any theme can use any layout: Standard v2 (side bar), Standard v1 (library in the side bar, the rest as text links in a toolbar), Icon rail, Top tabs, Bottom dock.
- An optional **wallpaper** (generated per theme or your own picture, with a darkness slider). Everything is per device.

How it works: none of this is in this repository any more. The colours, UI styles, layouts, wallpaper and effects live in the **themes** package in [turboengine](https://github.com/TurboNZL/turboengine/tree/main/themes) (named `turbothemes`) (an npm-style package shared by all of the owner's apps), and the app only starts its engine (`apps/web/src/lib/appearance.ts`). New and changed themes are downloaded in the background (Settings → Appearance → Themes) without an app update. To change a theme, edit its folder in that repository; the rules, the list of every palette and style, and the Liquid Glass write-up are in its `docs/`. See [docs/development/APPEARANCE.md](docs/development/APPEARANCE.md).

## Running it

**On a Raspberry Pi** (one command, then open the address it prints): `curl -fsSL https://raw.githubusercontent.com/TurboNZL/turbomusic/main/scripts/install-pi.sh | sudo bash -s -- --data-dir /mnt/yourdrive/turbomusic`. Details and what it does: [docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md), [docs/guides/DEPLOY_PI.md](docs/guides/DEPLOY_PI.md).

**From the source**, for development or any other machine: you need **Node 22.13+** and **pnpm** ([docs/development/TESTING.md](docs/development/TESTING.md) has nvm instructions). From the repo root:

```bash
# once, and after each update (--ignore-scripts skips dependency install scripts; none are needed to run the server or build the web client)
pnpm install --ignore-scripts --filter @turbomusic/core --filter @turbomusic/server --filter @turbomusic/web
pnpm --filter @turbomusic/web build

# start the server; it serves the built web client at /
cd packages/server
TURBOMUSIC_DATA_DIR=/path/to/data pnpm start
```

The server prints its address and a token (also in `<data dir>/token`). Open the address in a browser and paste the token in Settings → Server (leave the URL empty when the page is served by the server itself). Default port **47813**. For development run `pnpm --filter @turbomusic/web dev`; it proxies `/api` to `TURBOMUSIC_SERVER` (default `http://localhost:47813`).

**Desktop app:** `pnpm install --ignore-scripts --filter @turbomusic/electron …`, `node apps/electron/node_modules/electron/install.js` once, then `pnpm --filter @turbomusic/electron start` (details and installers in [docs/development/ELECTRON.md](docs/development/ELECTRON.md)). **Android:** download the APK from the newest [release](https://github.com/TurboNZL/turbomusic/releases), or build with Gradle ([docs/development/ANDROID.md](docs/development/ANDROID.md)).

**Server settings** (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `TURBOMUSIC_DATA_DIR` | `./data` | Where the database, files and token live (the external drive on a Pi). |
| `TURBOMUSIC_PORT` / `TURBOMUSIC_HOST` | `47813` / `0.0.0.0` | Listen address. |
| `TURBOMUSIC_TOKEN` | generated into `<data>/token` | The access token. |
| `TURBOMUSIC_MAX_UPLOAD_MB` | `1024` | Largest single file accepted. |
| `TURBOMUSIC_YTDLP`, `TURBOMUSIC_FFMPEG_DIR` | found on `PATH` | Tools for YouTube import and downloads. |
| `TURBOMUSIC_YTDLP_COOKIES`, `TURBOMUSIC_YTDLP_ARGS` | none | A cookies file and extra arguments for yt-dlp ([docs/guides/YTDLP_COOKIES.md](docs/guides/YTDLP_COOKIES.md)). |
| `TURBOMUSIC_WEB_DIR` | `apps/web/dist` | The client build to serve. |
| `TURBOMUSIC_UPDATE` | auto | `0` hides the Update server button, `1` shows it outside systemd. |

Desktop app only: `TURBOMUSIC_DESKTOP_PORT` (default 47814) and `TURBOMUSIC_SOFTWARE_RENDERING=1` (turn the GPU off, for diagnosing a driver).

To bring an old library across: `TURBOMUSIC_DATA_DIR=… node --experimental-strip-types --disable-warning=ExperimentalWarning packages/server/src/cli-migrate.ts --db <old>/data/turbomusic.db [--public <old>/public]` (idempotent).

## Updating and releases

- **Server on a Pi:** one command, [docs/guides/UPDATING.md](docs/guides/UPDATING.md) (`scripts/update.sh`).
- **Desktop and Android apps** update themselves from GitHub releases. Merging a pull request into `main` is the whole release process: a pushed branch gets a PR automatically (`auto-pr.yml`), every pushed branch is built by `build.yml` (installers, signed APK, server bundle; kept as workflow artifacts for 30 days), `check.yml` runs only on pushes to `main`, and a push to `main` makes `build.yml` pick the next version (`v2026.10.2`, ...) and publish the files **its pull request already built** when the source tree and the version still match (otherwise it builds them again), so a release takes about a minute instead of the full build. The release is created only once every file is attached, so an updater never finds a half-made one. Docs-only changes do not release. The apps use the newest published release, **including ones marked pre-release**. Settings → This app shows the state; a token is only needed if the repository is private.

## Guides

User guides (also inside the app: Settings → Guides): [docs/guides/GETTING_STARTED.md](docs/guides/GETTING_STARTED.md) (start here) · [desktop app](docs/guides/DESKTOP_APP.md) · [Android app](docs/guides/ANDROID_APP.md) · [Spotify](docs/guides/SPOTIFY.md) · [play on a device](docs/guides/CONNECT.md) · [Discord](docs/guides/DISCORD.md) · [server on Windows](docs/guides/WINDOWS_SERVER.md) · [server on Linux / Raspberry Pi](docs/guides/DEPLOY_PI.md) · [updating a server](docs/guides/UPDATING.md) · [YouTube cookies](docs/guides/YTDLP_COOKIES.md).

For developers: [turboengine](docs/development/ENGINE.md) (the shared reference this app is pinned to) · [PROJECT_BRIEF.md](PROJECT_BRIEF.md) (vision, rules, roadmap) · [CLAUDE.md](CLAUDE.md) (current state, decisions and gotchas) · [docs/development/](docs/development/) (Electron, Android, themes, packaging plan, Spotify research notes, trying it with a legacy library).
