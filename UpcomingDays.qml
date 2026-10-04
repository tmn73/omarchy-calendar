import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// The next few days that have something open, a handful of rows each, so
// the week ahead is in view without leaving the selected day. A day's
// heading selects that day; a row selects that event.
Column {
  id: root

  // Model.upcomingDays entries, each with a display `label` added.
  property var days: []
  property string timeFormat: "HH:mm"
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"

  signal daySelected(string key)
  signal itemSelected(var item)
  signal itemActivated(var item)
  signal joinRequested(var item)

  visible: days.length > 0
  spacing: Style.space(10)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function timeLabel(item) {
    if (!item.allDay) return Qt.formatDateTime(new Date(item.startMs), root.timeFormat)
    if (item.kind === "deadline") return root.tr("agenda.rowDeadline")
    if (item.kind === "task") return root.tr("agenda.rowTask")
    return root.tr("agenda.rowAllDay")
  }

  Text {
    text: root.tr("agenda.upcoming").toUpperCase()
    color: Util.alpha(root.foreground, 0.6)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
  }

  Repeater {
    model: root.days

    Column {
      id: day
      required property var modelData
      width: root.width
      spacing: Style.space(1)

      Button {
        text: day.modelData.label
        foreground: Util.alpha(root.foreground, 0.85)
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        horizontalPadding: Style.space(6)
        verticalPadding: Style.space(2)
        x: -Style.space(6)
        onClicked: root.daySelected(day.modelData.key)
      }

      Repeater {
        model: day.modelData.rows

        Rectangle {
          id: row
          required property var modelData
          readonly property string meetingUrl: Model.meetingUrlFor(modelData)

          width: day.width
          height: Math.max(rowTitle.implicitHeight, joinButton.visible ? joinButton.height : 0) + Style.space(5) * 2
          radius: Style.cornerRadius
          color: rowMouse.containsMouse ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"

          MouseArea {
            id: rowMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.itemSelected(row.modelData)
            onDoubleClicked: root.itemActivated(row.modelData)
          }

          Text {
            id: rowTime
            anchors.left: parent.left
            anchors.leftMargin: Style.space(6)
            anchors.top: rowTitle.top
            width: Style.space(64)
            text: root.timeLabel(row.modelData)
            elide: Text.ElideRight
            color: Util.alpha(root.foreground, 0.55)
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Rectangle {
            id: rowDot
            anchors.left: rowTime.right
            anchors.leftMargin: Style.space(4)
            anchors.top: rowTitle.top
            anchors.topMargin: Style.space(4)
            width: Style.space(6)
            height: width
            radius: width / 2
            color: row.modelData.color || root.foreground
          }

          Text {
            id: rowTitle
            anchors.left: rowDot.right
            anchors.right: joinButton.visible ? joinButton.left : parent.right
            anchors.leftMargin: Style.space(8)
            anchors.rightMargin: Style.space(6)
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: row.modelData.displayTitle || root.tr("common.noTitle")
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
            color: row.modelData.kind === "deadline" ? Color.urgent : root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          PanelActionButton {
            id: joinButton
            visible: row.meetingUrl !== ""
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            iconText: "󰕧"
            tooltipText: root.tr("agenda.openHost", [Model.meetingHost(row.meetingUrl) || row.modelData.displayTitle || ""])
            foreground: Color.accent
            fontFamily: root.fontFamily
            onClicked: root.joinRequested(row.modelData)
          }
        }
      }

      Text {
        visible: day.modelData.more > 0
        leftPadding: Style.space(66)
        text: Strings.trn(root.language, "agenda.more", day.modelData.more)
        color: Util.alpha(root.foreground, 0.5)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }
}
