import QtQuick
import qs.Commons

// A row that reads as a switch without pulling in a control library the
// rest of this plugin does not use.
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
  height: toggleBody.height + Style.space(6)
  radius: Style.cornerRadius
  color: hovered.hovered ? Qt.rgba(foreground.r, foreground.g, foreground.b, 0.06) : "transparent"

  HoverHandler { id: hovered }
  TapHandler { onTapped: toggle.activated() }

  Row {
    id: toggleBody
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.leftMargin: Style.space(3)
    anchors.rightMargin: Style.space(3)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(4)

    Text {
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(14)
      text: toggle.checked ? "✓" : ""
      color: toggle.foreground
      font.family: toggle.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Rectangle {
      anchors.verticalCenter: parent.verticalCenter
      visible: toggle.swatch.a > 0
      width: Style.space(4)
      height: width
      radius: width / 2
      color: toggle.checked ? toggle.swatch : "transparent"
      border.width: Style.spacing.hairline
      border.color: toggle.swatch
    }

    Column {
      anchors.verticalCenter: parent.verticalCenter
      width: toggleBody.width - Style.space(26)
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
  }
}
