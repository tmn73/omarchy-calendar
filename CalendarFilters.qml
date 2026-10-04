import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// One chip per calendar, with how many events it holds; clicking a chip
// hides or shows that calendar everywhere, the bar included. A hidden
// calendar keeps its chip, hollowed out, so it can be brought back.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property var calendars: []
  property var hiddenCalendars: []
  // { calendarId: number of events }
  property var counts: ({})

  signal toggled(string calendarId)

  visible: calendars.length > 0
  spacing: Style.space(8)

  Text {
    text: Strings.tr(root.language, "chips.title").toUpperCase()
    color: Util.alpha(root.foreground, 0.68)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
  }

  Flow {
    width: root.width
    spacing: Style.space(6)

    Repeater {
      model: root.calendars

      Rectangle {
        id: chip
        required property var modelData
        readonly property bool shown: root.hiddenCalendars.indexOf(String(modelData.id)) === -1

        width: chipRow.implicitWidth + Style.space(10) * 2
        height: chipRow.implicitHeight + Style.space(5) * 2
        radius: Style.cornerRadius > 0 ? height / 2 : 0
        color: chipMouse.containsMouse ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"
        border.width: Style.spacing.hairline
        border.color: Util.alpha(root.foreground, 0.2)

        Row {
          id: chipRow
          anchors.centerIn: parent
          spacing: Style.space(6)

          Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: Style.space(7)
            height: width
            radius: width / 2
            color: chip.shown ? chip.modelData.color : "transparent"
            border.width: Style.spacing.hairline
            border.color: chip.modelData.color
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: chip.modelData.name
            color: chip.shown ? root.foreground : Util.alpha(root.foreground, 0.45)
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: String(root.counts[chip.modelData.id] || 0)
            color: Util.alpha(root.foreground, 0.5)
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
        }

        MouseArea {
          id: chipMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.toggled(chip.modelData.id)
        }

        PanelToolTip {
          visible: chipMouse.containsMouse
          text: Strings.tr(root.language, "chips.toggle", [chip.modelData.name])
          fontFamily: root.fontFamily
        }
      }
    }
  }
}
