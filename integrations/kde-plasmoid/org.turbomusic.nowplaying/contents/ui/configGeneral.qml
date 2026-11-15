import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    property alias cfg_serverUrl: serverField.text
    property alias cfg_token: tokenField.text
    property alias cfg_showText: showTextBox.checked
    property alias cfg_textWidth: widthSpin.value

    QQC2.TextField {
        id: serverField
        Kirigami.FormData.label: i18n("Server address:")
        placeholderText: "http://192.168.1.20:47813"
    }
    QQC2.TextField {
        id: tokenField
        Kirigami.FormData.label: i18n("Access token:")
        echoMode: TextInput.Password
    }
    QQC2.CheckBox {
        id: showTextBox
        Kirigami.FormData.label: i18n("In the panel:")
        text: i18n("Show title and artist next to the cover")
    }
    QQC2.SpinBox {
        id: widthSpin
        Kirigami.FormData.label: i18n("Text width (px):")
        from: 80
        to: 600
        stepSize: 10
        enabled: showTextBox.checked
    }
}
