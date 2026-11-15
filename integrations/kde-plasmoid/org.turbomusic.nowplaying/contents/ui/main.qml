import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami

// TurboMusic now playing, for a Plasma panel (or the desktop). It asks the TurboMusic server what is playing about every
// second and a half (GET /api/nowplaying) and sends play/pause/next/previous back (POST /api/nowplaying/command).
// The server and token are set in the widget's own settings.
PlasmoidItem {
    id: root

    property var track: null          // { playing, trackId, meta: { title, artist, album, cover }, position, duration }
    property double receivedAt: 0
    property bool reachable: true
    readonly property string base: Plasmoid.configuration.serverUrl.replace(/\/+$/, "")
    readonly property string tok: encodeURIComponent(Plasmoid.configuration.token)
    readonly property string title: track && track.meta ? track.meta.title : ""
    readonly property string artist: track && track.meta ? track.meta.artist : ""
    readonly property bool playing: track ? track.playing : false
    readonly property string coverUrl: track && track.meta && track.meta.cover ? base + "/api/files/" + track.meta.cover + "?token=" + tok : ""
    property double position: 0

    Plasmoid.icon: "multimedia-player"
    toolTipMainText: title !== "" ? title : i18n("Nothing playing")
    toolTipSubText: artist
    preferredRepresentation: compactRepresentation

    function request(method, path, body, done) {
        var xhr = new XMLHttpRequest()
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE) return
            done(xhr.status, xhr.responseText)
        }
        xhr.open(method, base + path)
        if (body) xhr.setRequestHeader("Content-Type", "application/json")
        xhr.send(body ? JSON.stringify(body) : null)
    }

    function poll() {
        if (base === "" || Plasmoid.configuration.token === "") { reachable = false; track = null; return }
        request("GET", "/api/nowplaying?token=" + tok, null, function (status, text) {
            if (status !== 200) { reachable = false; return }
            reachable = true
            try { track = JSON.parse(text).track } catch (e) { track = null }
            receivedAt = Date.now()
            position = track ? track.position : 0
        })
    }

    function command(type) {
        request("POST", "/api/nowplaying/command?token=" + tok, { type: type }, function () { pollSoon.restart() })
    }

    Timer { interval: 1500; running: true; repeat: true; triggeredOnStart: true; onTriggered: root.poll() }
    Timer { id: pollSoon; interval: 400; onTriggered: root.poll() }
    // between polls the position moves on by itself
    Timer {
        interval: 500; running: root.playing; repeat: true
        onTriggered: if (root.track) root.position = Math.min(root.track.duration || 1e9, root.track.position + (Date.now() - root.receivedAt) / 1000)
    }

    function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2) }

    compactRepresentation: MouseArea {
        id: compact
        Layout.minimumWidth: row.implicitWidth
        Layout.preferredWidth: row.implicitWidth
        acceptedButtons: Qt.LeftButton | Qt.MiddleButton
        hoverEnabled: true
        onClicked: (mouse) => { if (mouse.button === Qt.MiddleButton) root.command("toggle"); else root.expanded = !root.expanded }

        RowLayout {
            id: row
            anchors.fill: parent
            spacing: Kirigami.Units.smallSpacing
            Image {
                Layout.preferredHeight: compact.height - 4
                Layout.preferredWidth: Layout.preferredHeight
                Layout.alignment: Qt.AlignVCenter
                source: root.coverUrl
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                visible: root.coverUrl !== ""
            }
            Kirigami.Icon {
                Layout.preferredHeight: compact.height - 4
                Layout.preferredWidth: Layout.preferredHeight
                source: "multimedia-player"
                visible: root.coverUrl === ""
            }
            ColumnLayout {
                visible: Plasmoid.configuration.showText && root.title !== ""
                Layout.maximumWidth: Plasmoid.configuration.textWidth
                Layout.alignment: Qt.AlignVCenter
                spacing: 0
                PlasmaComponents3.Label { Layout.fillWidth: true; text: root.title; elide: Text.ElideRight; font.bold: true; maximumLineCount: 1 }
                PlasmaComponents3.Label { Layout.fillWidth: true; text: root.artist; elide: Text.ElideRight; opacity: 0.7; maximumLineCount: 1; font.pointSize: Kirigami.Theme.smallFont.pointSize }
            }
        }
    }

    fullRepresentation: ColumnLayout {
        Layout.minimumWidth: Kirigami.Units.gridUnit * 16
        Layout.minimumHeight: Kirigami.Units.gridUnit * 18
        spacing: Kirigami.Units.largeSpacing

        Image {
            Layout.fillWidth: true
            Layout.preferredHeight: width
            source: root.coverUrl
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            visible: root.coverUrl !== ""
        }
        PlasmaComponents3.Label {
            Layout.fillWidth: true
            horizontalAlignment: Text.AlignHCenter
            visible: !root.reachable
            wrapMode: Text.WordWrap
            text: i18n("Cannot reach the server. Right-click the widget, choose Configure and check the address and token.")
        }
        PlasmaComponents3.Label { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: root.title !== "" ? root.title : i18n("Nothing playing"); font.bold: true; font.pointSize: Kirigami.Theme.defaultFont.pointSize * 1.2; elide: Text.ElideRight }
        PlasmaComponents3.Label { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: root.artist; opacity: 0.7; elide: Text.ElideRight }
        PlasmaComponents3.Slider {
            Layout.fillWidth: true
            enabled: false
            from: 0
            to: root.track && root.track.duration > 0 ? root.track.duration : 1
            value: root.position
        }
        RowLayout {
            Layout.fillWidth: true
            PlasmaComponents3.Label { text: root.fmt(root.position); opacity: 0.7 }
            Item { Layout.fillWidth: true }
            PlasmaComponents3.Label { text: root.fmt(root.track ? root.track.duration : 0); opacity: 0.7 }
        }
        RowLayout {
            Layout.alignment: Qt.AlignHCenter
            PlasmaComponents3.ToolButton { icon.name: "media-skip-backward"; onClicked: root.command("prev"); display: PlasmaComponents3.AbstractButton.IconOnly; PlasmaComponents3.ToolTip { text: i18n("Previous") } }
            PlasmaComponents3.ToolButton { icon.name: root.playing ? "media-playback-pause" : "media-playback-start"; onClicked: root.command("toggle"); display: PlasmaComponents3.AbstractButton.IconOnly; PlasmaComponents3.ToolTip { text: root.playing ? i18n("Pause") : i18n("Play") } }
            PlasmaComponents3.ToolButton { icon.name: "media-skip-forward"; onClicked: root.command("next"); display: PlasmaComponents3.AbstractButton.IconOnly; PlasmaComponents3.ToolTip { text: i18n("Next") } }
        }
        Item { Layout.fillHeight: true }
    }
}
