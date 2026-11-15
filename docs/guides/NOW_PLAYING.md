# Now playing on a stream, a panel or an overlay

TurboMusic can show what is playing outside the app in three ways. All of them follow **whichever of your devices is playing** (they read it from your server), so the app, the web client or your phone has to be connected to the server.

## 1. A widget for OBS (or any second screen)

Open **Settings > Server > Now playing widget**. Pick a player style (Compact, Boxy, Gallery, Minimal, macOS, Discord), a cover style (square, vinyl or none), and the options: cover glow, cover blur, hide while paused, show only for a few seconds after a song changes, size, progress colour and the text shown when nothing plays. The preview updates as you change things. Then:

1. Make sure the **address of this server** is one that the computer running OBS can reach (for example `http://192.168.1.20:47813`, not `localhost`, unless OBS runs on the same computer).
2. Press **Copy link**.
3. In OBS add a **Browser** source, paste the link as the URL, and set its width and height to the size of the area you want (for example 520 x 140 for the compact player at 1x). The background is see-through.

The link contains your access token, so anyone who has it can see what you play. Do not show it on stream. If you need to cancel it, change the token on the server.

## 2. A widget in a KDE Plasma panel

The folder `integrations/kde-plasmoid/org.turbomusic.nowplaying` in the repository is a Plasma 6 widget. It shows the cover and the title in the panel (middle-click plays or pauses) and opens a small player with previous, play/pause and next.

```bash
kpackagetool6 -t Plasma/Applet -i integrations/kde-plasmoid/org.turbomusic.nowplaying
```

Then right-click the panel, choose **Add or Manage Widgets**, find **TurboMusic Now Playing** and drag it in. Right-click it, **Configure**, and enter the server address and the access token. To update it later use `-u` instead of `-i`; to remove it use `-r org.turbomusic.nowplaying`.

KDE's own **Media Player** widget also works with the desktop app on Linux, because the app tells the system what it plays (the same way a browser does). Use whichever you prefer.

## 3. A floating overlay on any monitor (no panel needed)

If your second monitor has no panel, or you do not want a panel to take up screen space, open the widget as a small borderless window that stays on top:

1. Choose **Solid dark** (or light) as the background in the widget settings and copy the link.
2. Open it as an app window: `chromium --app="<the link>" --window-size=520,150` (or the same with `google-chrome`, `brave` or `vivaldi`).
3. KDE: right-click the window's title bar, **More Actions > Configure Special Window Settings**, add **Keep above**, **No titlebar and frame**, **Skip taskbar** and **Skip pager**, and under **Position** and **Size** choose the monitor and place it. KDE remembers this for that window.

Windows works the same way: open the link with `chrome --app=...` and pin it with PowerToys' **Always On Top** (Win + Ctrl + T). Tools that put music on the taskbar, like FluentFlyout, are limited to the primary taskbar by Windows itself; a pinned overlay window can sit on any screen.
