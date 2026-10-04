import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// One all-day item. Its marker says what it is: a deadline badge, a task
// circle (filled once done), or the calendar's dot for a plain event. The
// title wraps instead of eliding: these are mostly tasks and deadlines, and
// a long task name cut short is a task you cannot recognise.
Rectangle {
  id: root

  property var item: ({})
  property bool selected: false
  property bool snoozable: false
  property string snoozeText: ""
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"

  signal clicked()
  signal doubleClicked()
  signal snoozeRequested()

  readonly property bool declined: Model.isDeclined(item)
  readonly property bool faded: item.done === true || declined

  implicitHeight: Math.max(lines.implicitHeight, snoozeButton.visible ? snoozeButton.height : 0) + Style.space(7) * 2
  radius: Style.cornerRadius
  color: root.selected
    ? Style.selectedFillFor(root.foreground, Color.accent)
    : rowMouse.containsMouse ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"

  MouseArea {
    id: rowMouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
    onDoubleClicked: root.doubleClicked()
  }

  Item {
    id: marker
    anchors.left: parent.left
    anchors.leftMargin: Style.space(8)
    anchors.top: lines.top
    width: root.item.kind === "deadline" ? badge.width : Style.space(14)
    height: Style.space(14)

    Rectangle {
      visible: root.item.kind === "task"
      anchors.centerIn: parent
      width: Style.space(13)
      height: width
      radius: width / 2
      color: root.item.done ? root.item.color || root.foreground : "transparent"
      border.width: Math.max(1, Style.space(1.5))
      border.color: root.item.color || root.foreground
      opacity: root.item.done ? 0.6 : 1

      Text {
        visible: root.item.done === true
        anchors.centerIn: parent
        text: "󰄬"
        color: Color.background
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Rectangle {
      id: badge
      visible: root.item.kind === "deadline"
      anchors.verticalCenter: parent.verticalCenter
      width: badgeLabel.implicitWidth + Style.space(4) * 2
      height: badgeLabel.implicitHeight + Style.space(1) * 2
      radius: Style.cornerRadius
      color: "transparent"
      border.width: Style.spacing.hairline
      border.color: Color.urgent

      Text {
        id: badgeLabel
        anchors.centerIn: parent
        text: Strings.tr(root.language, "agenda.deadlineBadge").toUpperCase()
        color: Color.urgent
        font.family: root.fontFamily
        font.pixelSize: Math.max(1, Style.font.caption - 1)
        font.bold: true
        font.letterSpacing: 0.5
      }
    }

    Rectangle {
      visible: root.item.kind === "event"
      anchors.centerIn: parent
      width: Style.space(7)
      height: width
      radius: width / 2
      color: root.item.color || root.foreground
    }
  }

  Column {
    id: lines
    anchors.left: marker.right
    anchors.right: snoozeButton.visible ? snoozeButton.left : parent.right
    anchors.leftMargin: Style.space(8)
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(2)

    Text {
      width: parent.width
      textFormat: Text.PlainText
      text: root.item.displayTitle || Strings.tr(root.language, "common.noTitle")
      wrapMode: Text.Wrap
      maximumLineCount: 3
      elide: Text.ElideRight
      color: root.faded ? Util.alpha(root.foreground, 0.45) : root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
      font.strikeout: root.faded
    }

    Text {
      width: parent.width
      textFormat: Text.PlainText
      text: root.declined ? Strings.tr(root.language, "agenda.declined") : (root.item.calendarName || "")
      visible: text !== ""
      elide: Text.ElideRight
      color: Util.alpha(root.foreground, 0.5)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  AccentButton {
    id: snoozeButton
    visible: root.snoozable
    anchors.right: parent.right
    anchors.rightMargin: Style.space(6)
    anchors.verticalCenter: parent.verticalCenter
    filled: false
    iconText: "󰒲"
    tooltipText: root.snoozeText
    foreground: root.foreground
    fontFamily: root.fontFamily
    onClicked: root.snoozeRequested()
  }
}
