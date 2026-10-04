import QtQuick
import qs.Commons

// One choice of several, as a pill.
Rectangle {
  id: pill

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string label: ""
  property bool active: false

  signal activated()

  readonly property color muted: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.68)
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  width: pillLabel.width + Style.space(8)
  height: pillLabel.height + Style.space(4)
  radius: height / 2
  color: active ? Qt.rgba(foreground.r, foreground.g, foreground.b, 0.14) : "transparent"
  border.width: Style.spacing.hairline
  border.color: active ? muted : Qt.rgba(foreground.r, foreground.g, foreground.b, 0.36)

  Text {
    id: pillLabel
    anchors.centerIn: parent
    text: pill.label
    color: pill.active ? pill.foreground : pill.faint
    font.family: pill.fontFamily
    font.pixelSize: Style.font.caption
  }

  HoverHandler { cursorShape: Qt.PointingHandCursor }
  TapHandler { onTapped: pill.activated() }
}
