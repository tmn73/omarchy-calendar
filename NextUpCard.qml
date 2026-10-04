import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// Today's next timed event, or the one under way, above the agenda: what
// most people open a calendar to find out. A meeting link gets the big
// Join button here, so joining never needs a hunt through the list.
Rectangle {
  id: root

  property var item: null
  property real nowMs: 0
  property string timeFormat: "HH:mm"
  property bool snoozable: false
  property string snoozeText: ""
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"

  signal opened()
  signal joinRequested()
  signal snoozeRequested()

  readonly property bool live: !!item && item.phase === "now"
  readonly property string meetingUrl: Model.meetingUrlFor(item)
  readonly property string meetingHost: Model.meetingHost(meetingUrl)
  readonly property string badge: {
    if (!root.item) return ""
    if (root.live) return Strings.tr(root.language, "next.live")
    var minutes = Math.max(1, Math.ceil((root.item.startMs - root.nowMs) / 60000))
    return Strings.tr(root.language, "next.badge", [Model.spanText(minutes, root.language)])
  }
  readonly property string range: {
    if (!root.item) return ""
    var text = Qt.formatDateTime(new Date(root.item.startMs), root.timeFormat)
      + "–" + Qt.formatDateTime(new Date(root.item.endMs), root.timeFormat)
    return root.meetingHost !== "" ? text + " · " + root.meetingHost : text
  }

  visible: item !== null
  implicitHeight: Math.max(lines.implicitHeight, actions.height) + Style.space(12) * 2
  radius: Style.cornerRadius
  color: Style.selectedFillFor(root.foreground, Color.accent)

  Column {
    id: lines
    anchors.left: parent.left
    anchors.right: actions.left
    anchors.leftMargin: Style.space(14)
    anchors.rightMargin: Style.space(10)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(3)

    Text {
      text: root.badge.toUpperCase()
      color: Color.accent
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.letterSpacing: 1
      font.bold: true
    }

    Text {
      width: parent.width
      textFormat: Text.PlainText
      text: root.item ? (root.item.displayTitle || Strings.tr(root.language, "common.noTitle")) : ""
      wrapMode: Text.Wrap
      maximumLineCount: 3
      elide: Text.ElideRight
      color: titleMouse.containsMouse ? Style.hoverStateColor(root.foreground, Color.accent) : root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.title
      font.bold: true

      MouseArea {
        id: titleMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.opened()
      }
    }

    Text {
      text: root.range
      textFormat: Text.PlainText
      color: Util.alpha(root.foreground, 0.6)
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  Column {
    id: actions
    anchors.right: parent.right
    anchors.rightMargin: Style.space(12)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(6)

    AccentButton {
      visible: root.meetingUrl !== ""
      anchors.right: parent.right
      large: true
      iconText: "󰕧"
      text: Strings.tr(root.language, "agenda.join")
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.joinRequested()
    }

    AccentButton {
      visible: root.snoozable
      anchors.right: parent.right
      filled: false
      iconText: "󰒲"
      text: root.snoozeText
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.snoozeRequested()
    }
  }
}
