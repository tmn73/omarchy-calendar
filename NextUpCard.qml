import QtQuick
import qs.Commons
import qs.Commons as Commons
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
  property bool showProgress: true
  property bool snoozable: false
  property string snoozeText: ""
  property color foreground: Commons.Color.foreground
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
  // While the event is on: how far it has gone, and the time left. It moves
  // with the panel's minute tick.
  readonly property bool progressShown: root.showProgress && root.live && root.item.endMs > root.item.startMs
  readonly property var progress: progressShown ? Model.eventProgress(root.item, root.nowMs) : null
  readonly property real done: progress ? progress.done : 0
  readonly property string leftText: {
    if (!progress) return ""
    var left = progress.leftMinutes
    return Strings.trn(root.language, "next.left", Model.spanCount(left),
      [Model.spanText(left, root.language), Qt.formatDateTime(new Date(progress.endMs), root.timeFormat)])
  }

  visible: item !== null
  implicitHeight: Math.max(lines.implicitHeight, actions.height) + Style.space(12) * 2
  radius: Style.cornerRadius
  color: Style.selectedFillFor(root.foreground, Commons.Color.accent)

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
      color: Commons.Color.accent
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
      color: titleMouse.containsMouse ? Style.hoverStateColor(root.foreground, Commons.Color.accent) : root.foreground
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

    // Same look as the year bar in ProgressRails.
    Rectangle {
      visible: root.progressShown
      width: parent.width
      height: Style.space(6)
      radius: Style.cornerRadius > 0 ? height / 2 : 0
      color: Util.alpha(root.foreground, 0.12)

      Rectangle {
        width: Math.round(parent.width * root.done)
        height: parent.height
        radius: parent.radius
        color: Style.selectedStateColor(root.foreground, Commons.Color.accent)

        Behavior on width { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
      }
    }

    Text {
      visible: root.progressShown
      text: root.leftText
      textFormat: Text.PlainText
      color: Util.alpha(root.foreground, 0.6)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
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

    SecondaryButton {
      visible: root.snoozable
      anchors.right: parent.right
      iconText: "󰒲"
      text: root.snoozeText
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.snoozeRequested()
    }
  }
}
