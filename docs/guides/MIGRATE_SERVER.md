# Install or move your server (one folder, guided)

The server lives in **one folder** that you choose, for example `/mnt/data/turbomusic`. That folder holds the program, its own Node, ffmpeg, yt-dlp and (by default) your library. It updates itself from the app: Settings > Server > **Update server**. The installer asks you questions, shows a plan and only then changes anything. It creates **no accounts**: the server runs as the account you run the installer as.

## Install

As the account that should own the library (the one you normally log in with, not root):

```
sudo apt install curl xz-utils
curl -fsSL https://raw.githubusercontent.com/TurboNZL/turbomusic/main/scripts/install-server.sh | bash
```

It asks:

1. **Where should TurboMusic live?** It suggests your biggest extra drive.
2. **Where is your library?** An existing library is found and kept as it is.
3. **Which port?** 47813 unless you change it.
4. **Reachable from your network, or this machine only?** (Answer "only this machine" if just a Cloudflare tunnel on the machine should reach it.)

Then it shows the plan and asks "Go ahead?". `--dry-run` shows the plan and changes nothing; every answer can also be given as an option (`--root`, `--data-dir`, `--port`, `--local-only`, `--yes`; `--help` lists them).

## What it puts on the system drive

- **One service file**, `/etc/systemd/system/turbomusic.service`, a normal system service that runs as your account (sudo is asked for once to put it there). It waits for your drive to be mounted before starting.
- Optionally **`/var/log/journal`**, so the server's logs survive a reboot.
- `curl` and `xz-utils` must exist once. The installer refuses a folder on the same drive as `/` unless you pass `--allow-root-drive`.
- Only if you use Spotify's Soloist: `pipewire`, `pipewire-pulse` and `wireplumber` are system packages.

## Everyday commands

```
sudo systemctl restart turbomusic
sudo systemctl status turbomusic
journalctl -u turbomusic -n 50
```

- Update: Settings > Server > **Update server** (or rerun the installer with `--update`). It downloads the release bundle, checks its checksum, switches an `app` link and restarts; the last three versions are kept in `releases/`.
- Settings (port, tokens, YouTube cookies): `settings.env` in your folder, then restart. Rerunning the installer keeps that file as it is.
- A user service instead (no sudo, needs lingering): `--user-service`. Then the commands are `systemctl --user ...` (over SSH first: `export XDG_RUNTIME_DIR=/run/user/$(id -u)`).
- No systemd (for example some containers)? Use `--no-service` and start it by hand with `/your/folder/run.sh`.

## Moving from an older install

1. **Back up.** Settings > Library has the database and files export. Copy your data folder too if you can.
2. **Run the installer again** as the same account, pointing at the same folder (answer the first question with it). It keeps the installed version, your `settings.env` and your library, stops an older *user* service of that account if there is one, and installs the system service.
3. If an older install with a `curator` service or account exists, look first: `sudo bash scripts/remove-old-install.sh --dry-run`, then `--yes`. It never touches the library. Stop the old server first, because two servers must not share one database. The old `curator.db` is renamed to `turbomusic.db` on first start, with its history.
4. **Devices.** The Cloudflare tunnel keeps working: point it at the same port. The Android app and `.deb` packages were renamed, so install the new ones and remove the old ones (`music-curator*`). Your data comes from the server.
