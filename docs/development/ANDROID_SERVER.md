# Running the server on the phone: why Termux, and what else could work

The server is Node.js (`node:sqlite`, Hono), plus yt-dlp (Python) and ffmpeg. The Android app is a WebView shell with a native player. The beta server module runs all of that in **Termux** and the app drives it (`TermuxServer.kt`).

## Why the app cannot simply start the server itself
- **Android 10+ forbids running a program from the app's own data folder** (a W^X rule for apps targeting API 29+; the app targets 35). The only executable code an app may run is what is packaged inside the APK (native libraries in `jniLibs`, installed to `nativeLibraryDir`). Termux is exempt because it is built for this (it targets an old API on purpose).
- So Node, Python, ffmpeg and yt-dlp would all have to be shipped inside the APK as native libraries.

## Options, honestly
| Option | What it takes | Verdict |
|---|---|---|
| **Termux** (today) | the user installs Termux, one pasted line, then the app does the rest | works, but three moving parts the user sees |
| **Node embedded in the APK** (nodejs-mobile: Node as a library in an app) | the server runs in-process as a background thread in a foreground service | the project is community-maintained and tracks old Node lines; the server needs `node:sqlite` (Node 22.5+). Not verified for any nodejs-mobile build; likely means replacing the database layer. |
| **yt-dlp + ffmpeg inside the APK** (`youtubedl-android`: Python 3.x, yt-dlp and ffmpeg as libraries) | add the library, call it from Kotlin | the library exists and needs `extractNativeLibs=true`; this part is realistic |
| **Rewrite the server for Android** (Kotlin: sync, files, import using the library above) | a second implementation of every server route | the clean answer, a large project |

A real "service inside TurboMusic" is the last two rows together: no Termux, one app. It is weeks of work and two server code bases to keep equal, so it is a decision for the owner, not a patch.

## What Termux needs (and what we got wrong)
- The calling app declares `com.termux.permission.RUN_COMMAND`, the user grants it (App info > Permissions), and `allow-external-apps = true` is set inside Termux. Target SDK 30+ also needs `<queries><package android:name="com.termux"/></queries>` (present). Termux's wiki states these three; nothing documents an install-order rule.
- An earlier version here claimed Android ignores the permission "when Termux was installed after this app" and blocked the card on `getPermissionInfo`. That claim had no source, and it stopped a user whose Termux was installed first. The card now asks anyway, and **Test** runs a harmless command: if it runs, permission and switch are both proven. The card also prints what Android reports (Termux version, API level, declared / listed / granted / tested) so the next report is diagnosable.

## The spike: the server inside an Android app (`apps/android-server`, started 2026-10-17)
A second app, `app.turbomusic.server`, with **no screen and no launcher icon**: a foreground service in its own process (`:node`) that runs the bundled server (`headless.mjs` + the web client) with **Node as a library** (`libnode.so`). The TurboMusic app starts and stops it with an explicit intent (signature permission `app.turbomusic.server.permission.CONTROL`; both apps are signed with the same key). It targets the current Android version, so nothing is executed from app storage: `libnode.so` is packaged in the APK like any native library.

What was checked (2026-10-17, in the sandbox):
- **The release exists and has the right shape**: digidem/nodejs-mobile `v24.20.0-0` (`nodejs-mobile-android-24.20.0-0.zip`, 78 MB): `bin/{arm64-v8a,armeabi-v7a,x86_64}/libnode.so` (87 / 79 / 86 MB before the APK strips them) and `include/node`. It exports `_ZN4node5StartEiPPc` (`node::Start`) and contains SQLite, so **`node:sqlite` is available** (the `full` flavour; the `lite` one drops it). Node 24.x, maintained (tags up to 24.20.0, an upgrade branch for 24.22). The official nodejs-mobile repository is on old Node lines; this fork is why the idea is realistic.
- **The glue follows nodejs-mobile's own Android test app** (declare `node::Start`, one contiguous argv, stdout/stderr to logcat). `node-bridge.cpp` passes a host `g++ -fsyntax-only` check against the JDK's `jni.h` and a stub `android/log.h`; it was **not** compiled with the NDK.
- **The bundle runs on its own**: `scripts/make-bundle.sh` output, copied to a clean folder and run with the exact environment `ServerConfig.env` builds (plain Node 22 here, not libnode): `/api/health`, `/api/status` (SQLite opened), `/` and a deep link answered. This found a real bug: the bundled server only finds its web client through `TURBOMUSIC_WEB_DIR` (its own search is the monorepo path), so the environment now sets it.
- `ServerConfig` and its test compile and pass under Kotlin 2.0.21 (JVM, 4 tests). `scripts/fetch-libnode.sh` was run for real.

What was NOT checked: the Kotlin that touches Android (`ServerService`, `BundleInstaller`, `NodeHost`), the Gradle/CMake build, anything on an emulator or a phone. `.github/workflows/android-server.yml` builds the debug app and starts it on an emulator (API 34, x86_64) on every push that touches the module and fails unless `/api/health`, `/api/status` and `/` answer: **read its result first**. Debug builds have the service without the signature permission so `adb shell am start-foreground-service` can start it; release builds do not.

### What the first reply about "always the latest binaries" got wrong
- **Node cannot be downloaded at first launch.** nodejs.org ships no Android build (Android's C library is not glibc), so a downloaded Node tarball does not run on a phone. The Node in this design comes inside the APK (`libnode.so`), and a new Node means a new APK.
- **Downloaded programs cannot be run from app storage** by an app that targets Android 10 or newer (see above). That is the Termux trick, and it only works for apps that target an old Android version on purpose.
- yt-dlp is a Python script, so it can still be refreshed at runtime if Python itself is packaged in the APK (that is how `youtubedl-android` does it); ffmpeg has to be a packaged native library too.

### Open problems, in the order to attack them
1. **Does the server run on a real phone and an emulator?** (the workflow answers the emulator part). Look at memory (`--max-old-space-size-percentage=30` is a guess), startup time and what Android does to the process when the screen is off (`wake` extra holds a partial wake lock).
2. **yt-dlp and ffmpeg.** nodejs-mobile's FAQ warns that `child_process.spawn()` "will run into permission issues" on mobile. Whether spawning a packaged `lib*.so` executable works from inside libnode is **unknown**. If not, the Kotlin side runs them and the server asks over a local socket (the server's `acquire.ts`/`import.ts` spawn code would need a runner it can be given). Python for yt-dlp and a mobile ffmpeg build (both packaged as native libraries) still have to be chosen; `youtubedl-android` is the candidate.
3. **Integration in the TurboMusic app**: replace the Termux card with "Install the server app" (the same updater that installs the APK), start/stop with the explicit intent, hand over the token, show status. Until then the Termux module stays.
4. **Where the library lives**: today the app's own external files folder (no permission needed, deleted on uninstall); a chosen folder needs the storage-access framework and Node cannot use `content://` paths.
5. Updating: a new server version = a new APK (the in-app "Update server" bundle swap needs a writable, executable-free location and is not wired for this app).


## Wired into the app (2026-11-15)
- The Android SDK, NDK and CMake were installable in the sandbox this time: **both apps now compile here** (`gradle :app:testDebugUnitTest :app:assembleDebug` in `apps/android` and `apps/android-server`, and the server app's release APK, 72 MB, arm64). There is still no KVM, so nothing was run on an emulator or a phone.
- The TurboMusic app drives the server app: `ServerApp.kt` (status, start, stop with an explicit intent carrying a token the app made, port and wake option), `update/ServerAppInstaller.kt` (downloads `turbomusic-<v>-android-server.apk` from the newest release, Android's installer confirms), bridge methods `serverApp*`, manifest `uses-permission app.turbomusic.server.permission.CONTROL` + `<queries>`, web `lib/serverApp.ts` and `components/ServerAppCard.tsx` (Settings > This app, above the Termux card), autostart at app start (`startServerAppIfWanted`).
- A release now carries two APKs, so `Releases.newestWithApk` takes a suffix: the app looks for `-android.apk`, the installer for `-android-server.apk`. **Apps older than this change take the first `.apk` of a release**, which could be the server app: they should update before the next release (or the server APK should be uploaded after the app's).
- `build.yml` has an `android-server` job (arm64 only) and the release check requires its file.
- Not done: yt-dlp/ffmpeg inside the server app (the card says so), the library folder chooser, an emulator run, whether Android lets a background-started foreground service survive (battery optimisation settings are the owner's to test).
