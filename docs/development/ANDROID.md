# Android app and self-updates

`apps/android` is a native Kotlin app made of two parts:

- **The app itself** (`MainActivity`): the web client (bundled in the APK) in a full-screen WebView, so everything works the same as in the browser: library, voting, offline audio, themes. Set the server (your Pi) in Settings once. Android's file picker works for uploads.
  - The page is served from a private https address, and the server is usually plain http on the home network. The WebView allows that for data (sync), but Chromium is documented to upgrade the images, audio and video that an https page loads over http to https, which the server does not speak. That is the most likely reason the library showed as text with no pictures or sound (the symptom fits; it could not be reproduced without a device). So the app now serves its bundled page from `http://localhost` (an `http` page: Chromium treats localhost as a secure context, but an http page has no mixed-content rules), and images and audio load straight from the server through Chromium's own network stack, exactly as in a browser. Nothing is intercepted or proxied by the app. Switching from the earlier https address changes the page's origin, so the app's local copy (IndexedDB) starts empty once and re-syncs from the server; anything not yet synced on that device is lost. Everything else, and an https server, goes through the WebView unchanged. The matching rules and the release picker (`Releases`) are unit tested on the JVM (`app/src/test`); the WebView part has not run on a device.
- **Android Auto / media controls** (`PlaybackService`, a Media3 `MediaLibraryService`): Android Auto can only show a native media app, so this part browses your library (Albums, Artists, Playlists, Singles) straight from the server and plays the audio, with notification / lock screen / steering-wheel controls. The web client tells it which server you use (Settings > Server). It reads the same records as the web client; ratings are not shown in the car.

To use Android Auto without the Play Store: Android Auto settings > tap "Version" 10 times > developer settings > enable "Unknown sources".

## Updates (no command line, desktop or Android)

Both apps update themselves from the newest **GitHub release**:

1. Merge a pull request into `main`. `.github/workflows/auto-pr.yml` opens the PR by itself when a branch is pushed, and `.github/workflows/build.yml` has already built the Windows and Linux installers (electron-builder, which also writes the update manifest) and the signed APK when the branch was pushed; on the merge it picks the next version (`vYYYY.M.N`) and creates the release with those files, or builds them again when the source or the version changed meanwhile. Docs-only merges do not release; "Run workflow" in the Actions tab releases `main` on demand. (One-time setting: Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests".)
2. The desktop app checks at start and every 6 hours, downloads in the background and installs on quit, or from Settings > App updates > "Restart to update". The Android app checks when opened (at most every 6 hours), downloads the APK, and "Install update" opens Android's installer (first time: allow "install unknown apps" for TurboMusic).

**Pre-releases count.** Both apps pick the newest published release that has their file, whether or not GitHub marks it "pre-release" (GitHub's own "latest release" address ignores pre-releases and answers 404 when every release is one, which is how "can't find the repository" happened). Drafts are skipped. Release tags look like `v2026.10.1` (year.month.number); a higher number is newer.

**If the repository is private** the apps need a read-only token: GitHub > Settings > Developer settings > Fine-grained tokens, only this repository, permission **Contents: read-only**. Paste it in Settings > App updates > "Private repository?" on each device. Not needed while the repository is public.

Notes:
- The APK is signed with `apps/android/turbomusic.keystore`, committed on purpose (private repo, personal app): Android only installs an update signed with the same key as the installed app. Don't change it.
- macOS is not built: auto-update on macOS needs a paid Apple signing certificate.
- Nothing here has been run on a device. The sandbox that wrote it had no Android SDK, so the first CI run is the first compile of the Android project; expect to fix small things.
- The desktop self-update was checked up to "disabled in a development run"; real updates need an installed build and a release.

## Icons
The launcher icon, the website icon, the desktop icon and the title logo all come from one drawing (`scripts/gen-icons.mjs`, configured by `branding/logo.json`; the engine's `logos` module): the TurboNZL engine mark (a ring and a six-bladed wheel) with TurboMusic's red note on a dark plate in the centre, which is also the shape of the white notification icon (`ic_stat_turbomusic.xml`). The launcher icon is the same drawing in flat colours on the dark adaptive background.

## Discord (desktop app)

See [DISCORD.md](../guides/DISCORD.md) for the full guide (application id, art asset, privacy setting, Flatpak and Snap). Tested against a fake Discord IPC socket and a real Electron; not against real Discord.
