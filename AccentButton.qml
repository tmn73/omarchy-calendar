import QtQuick
import qs.Commons
import qs.Ui

// The panel's call to action, in the theme accent: filled for the one thing
// to do now ("Join" a live meeting, "Create"), outlined for the same action
// when it can wait. Not the kit's Button: that paints hover as a foreground
// wash, which on a filled accent would hide the button instead of lighting it.
Rectangle {
  id: root

  property string text: ""
  property string iconText: ""
  property string tooltipText: ""
  property bool filled: true
  property bool large: false
  property color foreground: Color.foreground
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal clicked()

  readonly property bool hot: mouse.containsMouse && enabled
  readonly property color labelColor: filled ? Color.background : accent
  readonly property int padX: Style.space(large ? 16 : 10)
  readonly property int padY: Style.space(large ? 11 : 5)

  implicitWidth: row.implicitWidth + padX * 2
  implicitHeight: row.implicitHeight + padY * 2
  radius: Style.cornerRadius
  opacity: enabled ? 1 : 0.5
  color: filled
    ? (hot ? Qt.lighter(accent, 1.12) : accent)
    : (hot ? Style.hoverFillFor(foreground, accent) : "transparent")
  border.width: filled ? 0 : Style.spacing.hairline
  border.color: Util.alpha(foreground, 0.25)

  Row {
    id: row
    anchors.centerIn: parent
    spacing: Style.space(6)

    Text {
      visible: root.iconText !== ""
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.iconText
      color: root.labelColor
      font.family: root.fontFamily
      font.pixelSize: root.large ? Style.font.iconLarge : Style.font.icon
    }

    Text {
      visible: root.text !== ""
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.text
      color: root.labelColor
      font.family: root.fontFamily
      font.pixelSize: root.large ? Style.font.title : Style.font.bodySmall
      font.bold: true
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    enabled: root.enabled
    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
  }

  PanelToolTip {
    visible: root.tooltipText !== "" && mouse.containsMouse
    text: root.tooltipText
    fontFamily: root.fontFamily
  }
}
