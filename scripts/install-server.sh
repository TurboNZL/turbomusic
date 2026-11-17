#!/usr/bin/env bash
# TurboMusic server, guided. ONE folder holds the program, its own Node, ffmpeg, yt-dlp and (by default) the library.
# It asks where things should go, shows what it will do, and only then does it. It never creates a user account: the server runs as
# the account you run this as. It runs as a normal system service (sudo is used once, to put the service file in place).
#
#   curl -fsSL https://raw.githubusercontent.com/TurboNZL/turbomusic/main/scripts/install-server.sh | bash
#
# Run it as the account that should own the library (not as root). Running it again repairs missing parts, keeps your settings and
# never changes the server version: updating is the "Update server" button in the app's Settings (or this script with --update).
#
# Everything it asks can be given as an option instead (then it asks nothing, or add --yes to accept the defaults):
#   --root DIR        the install folder, e.g. /mnt/data/turbomusic
#   --data-dir DIR    where the library lives (default: DIR/data). Point it at an existing library folder to keep it.
#   --port N          default 47813
#   --local-only      listen on this machine only (127.0.0.1), for when only a tunnel should reach the server
#   --user-service    run it as a user service of this account instead of a system service (no sudo, needs lingering)
#   --no-service      do not set up the start-at-boot service
#   --update          also fetch the newest server bundle now (a re-run otherwise keeps the installed version)
#   --yes             do not ask: use the options given and the defaults for the rest
#   --allow-root-drive  allow the folder on the same drive as /
#   --token T         a read-only GitHub token (only while the repository is private)
#   --bundle-file F --version V   use a server bundle you already have (offline installs, tests)
#   --dry-run         say what would be done and change nothing
set -euo pipefail

ROOT=""; DATA=""; PORT=""; SERVICE=1; SYSTEM=1; DRY=0; UPDATE=0; ALLOW_ROOT=0; TOKEN_ARG=""; BUNDLE_FILE=""; VERSION_ARG=""; YES=0; LOCAL=0
APP="turbomusic"
REPO="TurboNZL/turbomusic"
say() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then printf '   [dry-run] %s\n' "$*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:?--root needs a folder}"; shift 2 ;;
    --data-dir) DATA="${2:?--data-dir needs a folder}"; shift 2 ;;
    --port) PORT="${2:?--port needs a number}"; shift 2 ;;
    --local-only) LOCAL=1; shift ;;
    --user-service) SYSTEM=0; shift ;;
    --no-service) SERVICE=0; shift ;;
    --update) UPDATE=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --allow-root-drive) ALLOW_ROOT=1; shift ;;
    --token) TOKEN_ARG="${2:?--token needs a value}"; shift 2 ;;
    --bundle-file) BUNDLE_FILE="${2:?--bundle-file needs a file}"; shift 2 ;;
    --version) VERSION_ARG="${2:?--version needs a value}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

[ "$(id -u)" != 0 ] || die "run this as the account that should own the library, not as root. The server will run as that account; sudo is asked for only when needed."
for c in curl tar xz sha256sum; do command -v "$c" >/dev/null 2>&1 || die "'$c' is missing. On Debian/Ubuntu/Raspberry Pi OS: sudo apt install curl xz-utils (tar and sha256sum come with the system)."; done

case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH="x64"; FF_ARCH="linux64"; YT="yt-dlp_linux" ;;
  aarch64|arm64) NODE_ARCH="arm64"; FF_ARCH="linuxarm64"; YT="yt-dlp_linux_aarch64" ;;
  *) die "unsupported processor: $(uname -m) (64-bit Intel/AMD and 64-bit ARM, such as a Raspberry Pi 4/5 with a 64-bit OS, are supported)" ;;
esac

# --- questions. With `curl | bash` the script itself is stdin, so answers are read from the terminal (TURBOMUSIC_INSTALL_INPUT: a file, for tests).
INPUT_FD=""
if [ "$YES" != 1 ]; then
  if [ -n "${TURBOMUSIC_INSTALL_INPUT:-}" ]; then exec 3<"$TURBOMUSIC_INSTALL_INPUT"; INPUT_FD=1
  elif { : </dev/tty; } 2>/dev/null; then exec 3</dev/tty; INPUT_FD=1
  fi
fi
interactive() { [ "$INPUT_FD" = 1 ]; }
# ask VAR "question" "default": a blank answer takes the default
ask() {
  local var="$1" q="$2" def="$3" ans=""
  if interactive; then
    printf '\n%s\n  [%s] > ' "$q" "$def" >&2
    IFS= read -r ans <&3 || ans=""
  fi
  printf -v "$var" '%s' "${ans:-$def}"
}
confirm() {  # confirm "question" -> yes by default
  local ans=""
  if interactive; then printf '\n%s [Y/n] > ' "$1" >&2; IFS= read -r ans <&3 || ans=""; fi
  case "${ans:-y}" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

# the biggest mounted drive that is not the system drive (a USB/SSD library drive), for the suggested folder
biggest_drive() {
  local best="" bestkb=0 kb target
  while read -r kb target; do
    case "$target" in /mnt/*|/media/*|/srv|/srv/*|/data|/data/*) ;; *) continue ;; esac
    [ "$(stat -c %d "$target" 2>/dev/null)" = "$(stat -c %d / 2>/dev/null)" ] && continue
    [ "$kb" -gt "$bestkb" ] 2>/dev/null && { best="$target"; bestkb="$kb"; }
  done < <(df -P -k -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | awk 'NR>1 {print $4, $6}')
  printf '%s' "$best"
}
port_busy() { { ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null; } | awk '{print $4}' | grep -Eq "[:.]$1\$"; }

if [ -z "$ROOT" ]; then
  DRIVE="$(biggest_drive)"
  ask ROOT "Where should TurboMusic live? One folder holds the program, its tools and (by default) your library.${DRIVE:+
  (Your biggest extra drive is mounted at $DRIVE.)}" "${DRIVE:+$DRIVE/turbomusic}${DRIVE:-$HOME/turbomusic}"
fi
case "$ROOT" in /*) ;; *) die "the folder must be a full path starting with /" ;; esac
ROOT="${ROOT%/}"
if [ -z "$DATA" ]; then
  EXISTING=""
  for d in "$ROOT/data" /mnt/data/curator /var/lib/turbomusic "$HOME/turbomusic-data"; do [ -f "$d/turbomusic.db" ] || [ -f "$d/curator.db" ] && { EXISTING="$d"; break; }; done
  ask DATA "Where is (or should be) your music library? An existing library is kept as it is.${EXISTING:+
  (Found an existing library at $EXISTING.)}" "${EXISTING:-$ROOT/data}"
fi
case "$DATA" in /*) ;; *) die "the library folder must be a full path starting with /" ;; esac
DATA="${DATA%/}"
if [ -z "$PORT" ]; then
  ask PORT "Which port should the server listen on? Port numbers must be unique on this machine." "47813"
fi
case "$PORT" in ''|*[!0-9]*) die "the port must be a number" ;; esac
if port_busy "$PORT" && ! { [ -L "$ROOT/app" ] && systemctl is-active --quiet "$APP" 2>/dev/null; }; then
  note "Something already listens on port $PORT. If that is an older TurboMusic about to be replaced it is fine; otherwise choose another port (--port)."
fi
if [ "$LOCAL" != 1 ] && interactive; then
  confirm "Should other devices on your network be able to reach it directly? (Answer no if only a Cloudflare tunnel on this machine should.)" || LOCAL=1
fi

# --- summary
say "TurboMusic server: the plan"
note "Folder:    $ROOT"
note "Library:   $DATA"
if [ "$LOCAL" = 1 ]; then note "Port:      $PORT   (this machine only)"; else note "Port:      $PORT   (reachable from your network)"; fi
if [ "$SERVICE" = 1 ]; then
  if [ "$SYSTEM" = 1 ]; then note "Service:   system service, running as $USER (sudo is asked for once)"; else note "Service:   user service of $USER (no sudo; needs lingering to start at boot)"; fi
else note "Service:   none (start it yourself with $ROOT/run.sh)"; fi
note "Accounts:  none are created"
[ "$DRY" = 1 ] && note "(dry run: nothing will be changed)"
if [ "$YES" != 1 ] && interactive; then confirm "Go ahead?" || { echo "Nothing was changed."; exit 0; }; fi

# --- the root drive guard: the point of the folder is to keep everything on the big drive
mkdir -p "$ROOT" 2>/dev/null || {
  if [ "$DRY" = 1 ]; then :; elif [ "$YES" != 1 ] && interactive && confirm "$ROOT does not exist and $USER cannot create it. Create it with sudo and give it to $USER?"; then sudo mkdir -p "$ROOT" && sudo chown "$USER" "$ROOT"; else die "cannot create $ROOT. Create it once with: sudo mkdir -p $ROOT && sudo chown $USER $ROOT"; fi; }
if [ -d "$ROOT" ] && [ "$ALLOW_ROOT" != 1 ] && [ "$(stat -c %d "$ROOT")" = "$(stat -c %d /)" ] && [ "$ROOT" != "$HOME/turbomusic" ]; then
  die "$ROOT is on the same drive as the system (/). Is the drive mounted? Check with: findmnt. (Use --allow-root-drive if you really want this.)"
fi
[ "$DRY" = 1 ] || [ -w "$ROOT" ] || die "$ROOT is not writable for $USER: sudo chown -R $USER $ROOT"
run mkdir -p "$ROOT/tools" "$ROOT/releases" "$ROOT/.dl" "$DATA"
[ "$DRY" = 1 ] || [ -w "$DATA" ] || die "the library folder $DATA is not writable for $USER. If an older install owns it: sudo chown -R $USER $DATA"

TMP="$ROOT/.dl"   # downloads are kept on the same drive too
dl() { run curl -fsSL --retry 3 --connect-timeout 20 -o "$1" "$2"; }

# --- Node (its own copy, so the server never depends on the system's)
if [ -x "$ROOT/node/bin/node" ]; then note "Node: already here ($("$ROOT/node/bin/node" --version))"; else
  say "Node 22"
  if [ "$DRY" = 1 ]; then note "[dry-run] would download the newest Node 22 for $NODE_ARCH from nodejs.org and check its checksum"; else
    SUMS="$TMP/node-sums.txt"; dl "$SUMS" "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt"
    LINE="$(grep -E "node-v22\.[0-9.]+-linux-$NODE_ARCH\.tar\.gz\$" "$SUMS" | head -1)"; [ -n "$LINE" ] || die "could not find a Node 22 download for $NODE_ARCH"
    FILE="${LINE##* }"; SUM="${LINE%% *}"
    dl "$TMP/$FILE" "https://nodejs.org/dist/latest-v22.x/$FILE"
    [ "$(sha256sum "$TMP/$FILE" | cut -d' ' -f1)" = "$SUM" ] || die "the Node download is damaged (checksum differs); run again"
    mkdir -p "$ROOT/node" && tar -xzf "$TMP/$FILE" -C "$ROOT/node" --strip-components=1 && rm -f -- "${TMP:?}/$FILE"
    note "Node $("$ROOT/node/bin/node" --version) installed"
  fi
fi

# --- ffmpeg + ffprobe (static builds)
if [ -x "$ROOT/tools/ffmpeg" ] && [ -x "$ROOT/tools/ffprobe" ]; then note "ffmpeg: already here"; else
  say "ffmpeg"
  if [ "$DRY" = 1 ]; then note "[dry-run] would download a static ffmpeg for $FF_ARCH from github.com/yt-dlp/FFmpeg-Builds and check its checksum"; else
    FF="ffmpeg-master-latest-$FF_ARCH-gpl.tar.xz"; BASE="https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download"
    dl "$TMP/ff-sums.txt" "$BASE/checksums.sha256"; dl "$TMP/$FF" "$BASE/$FF"
    WANT="$(grep " $FF\$" "$TMP/ff-sums.txt" | cut -d' ' -f1)"; [ -n "$WANT" ] || die "no checksum listed for $FF"
    [ "$(sha256sum "$TMP/$FF" | cut -d' ' -f1)" = "$WANT" ] || die "the ffmpeg download is damaged (checksum differs); run again"
    tar -xJf "$TMP/$FF" -C "$ROOT/tools" --wildcards '*/bin/ffmpeg' '*/bin/ffprobe' --strip-components=2
    rm -f -- "${TMP:?}/$FF"; chmod 755 "$ROOT/tools/ffmpeg" "$ROOT/tools/ffprobe"
    note "ffmpeg installed"
  fi
fi

# --- yt-dlp (updates itself every time the server starts)
if [ -x "$ROOT/tools/yt-dlp" ]; then note "yt-dlp: already here"; else
  say "yt-dlp"
  dl "$ROOT/tools/yt-dlp" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YT"
  run chmod 755 "$ROOT/tools/yt-dlp"
fi

# --- the server bundle (headless.mjs + web/)
CURRENT=""; if [ -L "$ROOT/app" ]; then CURRENT="$(basename "$(readlink "$ROOT/app")")"; fi
if [ -n "$CURRENT" ] && [ "$UPDATE" != 1 ] && [ -z "$BUNDLE_FILE" ]; then note "TurboMusic: version $CURRENT is installed (use the app's Update server button, or --update)"; else
  say "TurboMusic server bundle"
  if [ "$DRY" = 1 ]; then note "[dry-run] would download the newest release's server bundle from github.com/$REPO and unpack it into $ROOT/releases/"; else
    CLEAN=0
    if [ -n "$BUNDLE_FILE" ]; then VER="${VERSION_ARG:?--bundle-file needs --version}"; FILE="$BUNDLE_FILE"; else
      HDR=(-H "Accept: application/vnd.github+json"); if [ -n "$TOKEN_ARG" ]; then HDR+=(-H "Authorization: Bearer $TOKEN_ARG"); fi
      curl -fsSL "${HDR[@]}" "https://api.github.com/repos/$REPO/releases?per_page=20" -o "$TMP/releases.json" || die "GitHub does not show $REPO (a private repository needs --token)"
      PICK="$("$ROOT/node/bin/node" -e '
        const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).filter(x=>!x.draft);
        const num=t=>t.replace(/^v/,"").split(".").map(Number);
        const cmp=(a,b)=>{const x=num(a),y=num(b);for(let i=0;i<4;i++){const d=(y[i]||0)-(x[i]||0);if(d)return d}return 0};
        for(const x of r.sort((a,b)=>cmp(a.tag_name,b.tag_name))){const a=(x.assets||[]).find(a=>/^turbomusic-server-.*-(node|termux)\.tar\.gz$/.test(a.name));
          if(a){console.log([x.tag_name.replace(/^v/,""),a.name,process.argv[2]?a.url:a.browser_download_url,(a.digest||"").replace(/^sha256:/,"")].join(" "));break}}' "$TMP/releases.json" "$TOKEN_ARG")"
      [ -n "$PICK" ] || die "no release has a server bundle yet. Wait for the next release, or use --bundle-file."
      read -r VER NAME URL DIGEST <<<"$PICK"; FILE="$TMP/$NAME"; CLEAN=1
      note "version $VER"
      if [ -n "$TOKEN_ARG" ]; then curl -fsSL --retry 3 -H "Accept: application/octet-stream" -H "Authorization: Bearer $TOKEN_ARG" -o "$FILE" "$URL"; else curl -fsSL --retry 3 -o "$FILE" "$URL"; fi
      if [ -n "$DIGEST" ]; then [ "$(sha256sum "$FILE" | cut -d' ' -f1)" = "$DIGEST" ] || die "the server bundle is damaged (checksum differs); run again"; fi
    fi
    rm -rf -- "${ROOT:?}/releases/.new" "${ROOT:?}/releases/${VER:?}"; mkdir -p "$ROOT/releases/.new"
    tar -xzf "$FILE" -C "$ROOT/releases/.new"
    [ -f "$ROOT/releases/.new/headless.mjs" ] && [ -f "$ROOT/releases/.new/web/index.html" ] || die "that is not a TurboMusic server bundle"
    mv "$ROOT/releases/.new" "$ROOT/releases/$VER"
    ln -sfn "releases/$VER" "$ROOT/app.tmp" && mv -T "$ROOT/app.tmp" "$ROOT/app"
    if [ "$CLEAN" = 1 ]; then rm -f -- "$FILE"; fi
    note "installed $VER"
  fi
fi

# --- settings, start script, service file (settings.env is written once; your edits to it are kept)
HOSTV="0.0.0.0"; [ "$LOCAL" = 1 ] && HOSTV="127.0.0.1"
if [ "$DRY" != 1 ]; then
  if [ -f "$ROOT/settings.env" ]; then note "settings.env already exists and is kept as it is (the port, library and network choices above only apply to a new install: edit that file to change them)"; else
    cat > "$ROOT/settings.env" <<ENV
# TurboMusic server settings. Plain KEY=VALUE lines; restart the server after changing them.
TURBOMUSIC_DATA_DIR=$DATA
TURBOMUSIC_PORT=$PORT
# Reachable from your network (0.0.0.0) or only from this machine (127.0.0.1, e.g. when only a tunnel should reach it):
TURBOMUSIC_HOST=$HOSTV
# YouTube asks some servers to prove they are not a bot: a cookies file from a signed-in browser answers it.
#TURBOMUSIC_YTDLP_COOKIES=$DATA/cookies.txt
# Only while the GitHub repository is private (the in-app update then needs to read its releases):
#TURBOMUSIC_GITHUB_TOKEN=
ENV
  fi
  cat > "$ROOT/run.sh" <<'RUN'
#!/bin/sh
# Starts TurboMusic from this folder only (nothing outside it is used). Settings are in settings.env next to this file.
ROOT="$(cd "$(dirname "$0")" && pwd)"
[ -f "$ROOT/settings.env" ] && { set -a; . "$ROOT/settings.env"; set +a; }
export PATH="$ROOT/node/bin:$ROOT/tools:$PATH"
export TURBOMUSIC_INSTALL_ROOT="$ROOT"
export TURBOMUSIC_DATA_DIR="${TURBOMUSIC_DATA_DIR:-$ROOT/data}"
export TURBOMUSIC_WEB_DIR="$ROOT/app/web"
export TURBOMUSIC_YTDLP="$ROOT/tools/yt-dlp"
export TURBOMUSIC_FFMPEG_DIR="$ROOT/tools"
export TURBOMUSIC_YTDLP_ARGS="--js-runtimes node ${TURBOMUSIC_YTDLP_ARGS:-}"
export TURBOMUSIC_VERSION="$(basename "$(readlink "$ROOT/app")")"
mkdir -p "$TURBOMUSIC_DATA_DIR/tmp" "$TURBOMUSIC_DATA_DIR/cache"
export TMPDIR="$TURBOMUSIC_DATA_DIR/tmp" XDG_CACHE_HOME="$TURBOMUSIC_DATA_DIR/cache"
# yt-dlp breaks whenever YouTube changes; it updates itself (quietly, in the background, a failure changes nothing)
( "$ROOT/tools/yt-dlp" -U >/dev/null 2>&1 || true ) &
exec "$ROOT/node/bin/node" --disable-warning=ExperimentalWarning "$ROOT/app/headless.mjs"
RUN
  chmod 755 "$ROOT/run.sh"
  if [ "$SYSTEM" = 1 ]; then
    # a normal system service run by this account: plain `sudo systemctl restart turbomusic`, logs in `journalctl -u turbomusic`.
    # RequiresMountsFor waits for the drive; XDG_RUNTIME_DIR lets Soloist reach this account's audio (PipeWire) when it is running.
    cat > "$ROOT/turbomusic.service" <<UNIT
[Unit]
Description=TurboMusic server
After=network-online.target
Wants=network-online.target
RequiresMountsFor=$ROOT $DATA

[Service]
User=$USER
Group=$(id -gn)
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u)
ExecStart=$ROOT/run.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
  else
    cat > "$ROOT/turbomusic.service" <<UNIT
[Unit]
Description=TurboMusic server
After=network-online.target

[Service]
# if the drive is not mounted yet, this fails and the service tries again in 10 seconds
ExecStartPre=/bin/sh -c 'test -x "$ROOT/run.sh"'
ExecStart=$ROOT/run.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT
  fi
fi

# --- start at boot
STARTED=0
if [ "$SERVICE" = 1 ]; then
  say "Service"
  if [ "$DRY" = 1 ]; then
    if [ "$SYSTEM" = 1 ]; then note "[dry-run] would stop an older user service of $USER if there is one, copy $ROOT/turbomusic.service to /etc/systemd/system with sudo, enable it and start it"
    else note "[dry-run] would link $ROOT/turbomusic.service as a user service, enable it and turn on lingering"; fi
  elif [ "$SYSTEM" = 1 ]; then
    command -v systemctl >/dev/null 2>&1 || die "systemctl is missing, so there is no service manager. Start the server yourself with $ROOT/run.sh"
    # an older install ran as a user service: stop it so two copies never fight for the port
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"   # over SSH this is often unset, and the user manager is then not found
    if systemctl --user show-environment >/dev/null 2>&1 && systemctl --user cat turbomusic.service >/dev/null 2>&1; then
      note "stopping the older user service of $USER"
      systemctl --user disable --now turbomusic.service >/dev/null 2>&1 || true
      rm -f "$HOME/.config/systemd/user/turbomusic.service" 2>/dev/null || true
      systemctl --user daemon-reload >/dev/null 2>&1 || true
    fi
    note "sudo is needed once, to install the service file"
    sudo install -m 644 "$ROOT/turbomusic.service" /etc/systemd/system/turbomusic.service
    sudo systemctl daemon-reload
    sudo systemctl enable turbomusic.service >/dev/null 2>&1 || true
    sudo systemctl restart turbomusic.service && STARTED=1
    # logs survive a reboot only when this folder exists (Raspberry Pi OS does not create it)
    if [ ! -d /var/log/journal ]; then
      if confirm "Keep the server's logs across reboots? (creates /var/log/journal; small)"; then sudo mkdir -p /var/log/journal && sudo systemd-tmpfiles --create --prefix /var/log/journal >/dev/null 2>&1 && sudo systemctl restart systemd-journald >/dev/null 2>&1 || true; fi
    fi
  elif systemctl --user show-environment >/dev/null 2>&1; then
    systemctl --user link "$ROOT/turbomusic.service" >/dev/null 2>&1 || true
    systemctl --user daemon-reload
    systemctl --user enable turbomusic.service >/dev/null 2>&1 || true
    systemctl --user restart turbomusic.service && STARTED=1
    if loginctl enable-linger "$USER" >/dev/null 2>&1; then note "starts at boot, even when nobody is logged in"; else note "To start at boot without anyone logged in, run once:  sudo loginctl enable-linger $USER"; fi
  else
    note "No user service manager here (no login session with systemd). Start it with: $ROOT/run.sh"
  fi
fi

say "Done"
if [ "$DRY" != 1 ]; then
  if [ "$STARTED" = 1 ]; then for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do [ -s "$DATA/token" ] && break; sleep 1; done; fi
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  note "Open:   http://${IP:-<this machine>}:$PORT"
  if [ -s "$DATA/token" ]; then note "Token:  $(cat "$DATA/token")   (also in $DATA/token)"; else note "The token appears in $DATA/token when the server first starts."; fi
  note "Update: Settings -> Update server in the app (nothing to do here)"
  if [ "$SERVICE" != 1 ]; then
    note "Start:   $ROOT/run.sh"
  elif [ "$SYSTEM" = 1 ]; then
    note "Restart: sudo systemctl restart turbomusic"
    note "Logs:    journalctl -u turbomusic -n 50"
  else
    note "Restart: systemctl --user restart turbomusic   (over SSH first: export XDG_RUNTIME_DIR=/run/user/\$(id -u))"
    note "Logs:    journalctl --user -u turbomusic -n 50"
  fi
fi
