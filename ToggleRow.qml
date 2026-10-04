import QtQuick
import qs.Commons
import qs.Ui

// A labelled on/off row: an optional colour swatch, the label with a hint
// under it, and the kit's switch at the right. The whole row takes the
// click, so the switch is not interactive on its own.
Rectangle {
  id: toggle

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string label: ""
  property string hint: ""
  property bool checked: false
  property color swatch: "transparent"

  signal activated()

  // Same fades as SettingsView: Qt.darker only reads as quieter on a dark
  // background, and on a light theme it raises contrast instead.
  readonly property color muted: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.68)
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  width: parent ? parent.width : 0
  height: Math.max(texts.implicitHeight, toggleSwitch.implicitHeight) + Style.space(6)
  radius: Style.cornerRadius
  color: hovered.hovered ? Qt.rgba(foreground.r, foreground.g, foreground.b, 0.06) : "transparent"

  HoverHandler {
    id: hovered
    cursorShape: Qt.PointingHandCursor
  }
  TapHandler { onTapped: toggle.activated() }

  Rectangle {
    id: swatchDot
    visible: toggle.swatch.a > 0
    anchors.left: parent.left
    anchors.leftMargin: Style.space(4)
    anchors.verticalCenter: parent.verticalCenter
    width: Style.space(7)
    height: width
    radius: width / 2
    color: toggle.checked ? toggle.swatch : "transparent"
    border.width: Style.spacing.hairline
    border.color: toggle.swatch
  }

  Column {
    id: texts
    anchors.left: swatchDot.visible ? swatchDot.right : parent.left
    anchors.leftMargin: Style.space(swatchDot.visible ? 7 : 4)
    anchors.right: toggleSwitch.left
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(1)

    Text {
      width: parent.width
      // Calendar names come from the events file, so a shared calendar or
      // a third-party writer chooses this string, not the plugin.
      textFormat: Text.PlainText
      text: toggle.label
      color: toggle.checked ? toggle.foreground : toggle.muted
      font.family: toggle.fontFamily
      font.pixelSize: Style.font.bodySmall
      elide: Text.ElideRight
    }

    Text {
      width: parent.width
      visible: toggle.hint !== ""
      text: toggle.hint
      color: toggle.faint
      font.family: toggle.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }
  }

  ToggleSwitch {
    id: toggleSwitch
    anchors.right: parent.right
    anchors.rightMargin: Style.space(4)
    anchors.verticalCenter: parent.verticalCenter
    checked: toggle.checked
    interactive: false
    trackHeight: Style.space(18)
    foreground: toggle.foreground
  }
}
