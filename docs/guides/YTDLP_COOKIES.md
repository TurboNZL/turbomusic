# yt-dlp: "Sign in to confirm you're not a bot"

```
ERROR: [youtube] b5bR2NqDpqI: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.
```

## What it means

YouTube sometimes refuses a download from a server it does not trust and asks the caller to prove it is a signed-in person. Home connections on a Pi are usually fine, but YouTube decides per video and per moment, which is why only a few tracks fail (the failed count in Settings → Audio). Nothing is wrong with the track or with yt-dlp.

## What the server already does

- When a download is refused like this it **retries once** with the player clients that need no proof of origin (`visionos`, `web_embedded`, `mweb`, then `android`, `tv_downgraded`; `android_vr` was dropped because YouTube now answers it with 403). That rescues many tracks on its own.
- If that is refused too, the track is marked failed with a message that points here. **Settings → Audio → Progress** lists every failed track and its error. Pressing **Download missing audio** again retries them.
- YouTube is also gentler on slow clients: the server downloads two tracks at a time. Retrying later, in a smaller batch, often works.

## The fix that lasts: give yt-dlp a cookies file

yt-dlp accepts a cookies file exported from a browser that is signed in to YouTube. Using your account carries a risk (YouTube can limit or ban an account used for bulk downloads), so **use a throwaway Google account** rather than your main one, and keep the volume low. This follows the [yt-dlp wiki](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies) and [FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp).

### 1. Export the cookies (private window method)

YouTube rotates the cookies of an open browser session, which makes an exported file stop working within days. The private-window method avoids that:

1. Open a **private / incognito window** and sign in to YouTube.
2. In the **same tab**, go to `https://www.youtube.com/robots.txt` (it must be the only private tab open).
3. With a cookies-export extension (the FAQ recommends them), export the `youtube.com` cookies as **Netscape format** (`cookies.txt`). The first line must be `# Netscape HTTP Cookie File`.
4. **Close the private window** so the session is never used in the browser again.

Do not use `--cookies-from-browser` together with `--cookies` for this: it would export your normal session, not the private one.

### 2. Copy the file to the server (run this on your own computer)

The cookies are exported on **your own computer**, so this first command is run **there**, in the folder where `cookies.txt` was saved. It copies the file to the server over SSH. Use the account that owns the server's folder (the one you installed with) and your server's address:

```
scp cookies.txt YOUR_USER@PI_ADDRESS:/mnt/data/turbomusic/data/youtube-cookies.txt
```

Replace `/mnt/data/turbomusic` with the folder you gave the installer as `--root`; the file goes into its `data` folder (or into your library folder if you chose another with `--data-dir`). Because that account owns the folder, **no `sudo`, `chown` or `/etc` is needed**.

Everything from here on is run **on the server** (`ssh YOUR_USER@PI_ADDRESS`), not on your computer:

```
chmod 600 /mnt/data/turbomusic/data/youtube-cookies.txt
```

The file lets anyone who has it act as that account on YouTube, so keep it private (mode 600), out of the repository and out of backups you share. Line endings must be LF on Linux (an "HTTP Error 400" with `--cookies` points at wrong line endings).

### 3. Tell the server about it (on the server)

Open `settings.env` in the install folder and add (or un-comment) this line, with the real path:

```
nano /mnt/data/turbomusic/settings.env
TURBOMUSIC_YTDLP_COOKIES=/mnt/data/turbomusic/data/youtube-cookies.txt
```

Make sure there is only ONE such line, and that it is not left over from the installer (it writes a commented example whose path is the data folder you gave it, which may be an old one). A path to a folder that does not exist makes yt-dlp crash with an unhelpful `[PYI-...] Failed to execute script` error. Check with `grep -n COOKIES /mnt/data/turbomusic/settings.env`.

Then restart the server: `sudo systemctl restart turbomusic`. (If you chose the user-service option when installing, it is `systemctl --user restart turbomusic`, and over `su` or `sudo -iu` run `export XDG_RUNTIME_DIR=/run/user/$(id -u)` first.) No systemd session at all? Stop `run.sh` and start it again.

`TURBOMUSIC_YTDLP_COOKIES` becomes `--cookies <file>` on every yt-dlp call (downloads and album look-ups). For anything else yt-dlp should always get, `TURBOMUSIC_YTDLP_ARGS` takes extra arguments separated by spaces (for example `--js-runtimes node`). The one-folder install already sets up yt-dlp's tools and runtime, so that is rarely needed.

Check: **Settings → Server → Test connection** now says `cookies: set`. Then **Settings → Audio → Download missing audio** retries the failed tracks.

yt-dlp writes refreshed cookies back to the file while it runs, so the account that runs the server must be able to write it (it does, as the file sits in its own folder).

**Old systemd install** (the `curator` / `turbomusic` service account and `/etc/turbomusic/...`): the same idea applies, but put the file in `/etc/turbomusic/`, `chown` it to the service account, and add the `Environment=TURBOMUSIC_YTDLP_COOKIES=...` line to the unit (`sudo systemctl edit --full turbomusic`, then `sudo systemctl daemon-reload && sudo systemctl restart turbomusic`). [MIGRATE_SERVER.md](MIGRATE_SERVER.md) moves you off it.

## If it keeps failing

- Update yt-dlp: `/mnt/data/turbomusic/tools/yt-dlp -U` (use your own folder; `run.sh` also tries `-U` in the background every time the server starts). Old versions are the second most common cause.
- Make sure yt-dlp has a JavaScript runtime (the one-folder install brings Node; the old systemd install needs DEPLOY_PI.md section 4); without it YouTube returns few or no formats.
- Re-export the cookies (they expire, or YouTube may have invalidated that session) and replace the file; no restart is needed for a replaced file.
- A PO-token provider (such as the `bgutil-ytdlp-pot-provider` plugin) is the heavier alternative if cookies are not an option; it is not set up by this project.
- Space the downloads out: the wiki's rough limits are about 300 videos an hour for a guest and about 2000 for a signed-in account.
