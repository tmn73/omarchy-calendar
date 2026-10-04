import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// One timed event: start and end down the left, the calendar's dot, the
// title (wrapping), and how far off it is. A meeting link always gets its
// button, outlined with the service's name, filled "Join" once it is time.
// Past rows fade and the one under way is washed, so the list reads as a
// timeline rather than a list.
Rectangle {
  id: root

  property var item: ({})
  property bool selected: false
  property bool snoozable: false
  property string snoozeText: ""
  property bool isToday: false
  property real nowMs: 0
  property string todayKey: ""
  property string timeFormat: "HH:mm"
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"

  signal clicked()
  signal doubleClicked()
  signal joinRequested()
  signal snoozeRequested()

  readonly property string phase: item.phase || "later"
  readonly property bool declined: Model.isDeclined(item)
  readonly property string meetingUrl: Model.meetingUrlFor(item)
  readonly property string meetingHost: Model.meetingHost(meetingUrl)
  readonly property bool joinable: Model.isJoinableNow(item, nowMs, todayKey)
  readonly property bool soon: phase === "now" || (phase === "later" && item.startMs - nowMs <= 15 * 60000)
  readonly property string countdown: isToday && phase !== "past" ? Model.relativeTime(item, nowMs, language) : ""
  readonly property string note: {
    if (root.declined) return Strings.tr(root.language, "agenda.declined")
    if (Model.isOutOfOffice(root.item)) return Strings.tr(root.language, "agenda.outOfOffice")
    var place = String(root.item.location || "")
    return place === root.meetingUrl ? "" : place
  }

  function clock(ms) {
    return Qt.formatDateTime(new Date(ms), root.timeFormat)
  }

  implicitHeight: Math.max(lines.implicitHeight, times.implicitHeight, actions.height) + Style.space(8) * 2
  radius: Style.cornerRadius
  color: root.selected
    ? Style.selectedFillFor(root.foreground, Color.accent)
    : rowMouse.containsMouse
      ? Style.hoverFillFor(root.foreground, Color.accent)
      : root.phase === "now" ? Util.alpha(Color.accent, 0.10) : "transparent"

  MouseArea {
    id: rowMouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
    onDoubleClicked: root.doubleClicked()
  }

  Item {
    id: body
    anchors.fill: parent
    opacity: root.phase === "past" ? 0.45 : 1

    Column {
      id: times
      anchors.left: parent.left
      anchors.leftMargin: Style.space(8)
      anchors.top: lines.top
      width: Style.space(40)
      spacing: Style.space(1)

      Text {
        text: root.clock(root.item.startMs)
        color: root.phase === "now" && !root.declined ? Color.accent : root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.strikeout: root.declined
      }

      Text {
        text: root.clock(root.item.endMs)
        color: Util.alpha(root.foreground, 0.5)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Rectangle {
      id: dot
      anchors.left: times.right
      anchors.leftMargin: Style.space(4)
      anchors.top: lines.top
      anchors.topMargin: Style.space(4)
      width: Style.space(7)
      height: width
      radius: width / 2
      color: root.declined ? Qt.darker(root.item.color || root.foreground, 2.2) : (root.item.color || root.foreground)
    }

    Column {
      id: lines
      anchors.left: dot.right
      anchors.right: parent.right
      anchors.leftMargin: Style.space(8)
      anchors.rightMargin: actions.width + Style.space(12)
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(2)

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: root.item.displayTitle || Strings.tr(root.language, "common.noTitle")
        wrapMode: Text.Wrap
        maximumLineCount: 3
        elide: Text.ElideRight
        color: root.declined || root.item.done ? Util.alpha(root.foreground, 0.46) : root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        font.strikeout: root.declined || root.item.done === true
      }

      Text {
        visible: text !== ""
        width: parent.width
        textFormat: Text.PlainText
        text: root.countdown
        color: root.soon ? Color.accent : Util.alpha(root.foreground, 0.6)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: root.soon
      }

      Text {
        visible: text !== ""
        width: parent.width
        textFormat: Text.PlainText
        text: root.note
        elide: Text.ElideRight
        color: Util.alpha(root.foreground, 0.5)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  Row {
    id: actions
    anchors.right: parent.right
    anchors.rightMargin: Style.space(6)
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(4)

    AccentButton {
      visible: root.snoozable
      filled: false
      iconText: "󰒲"
      tooltipText: root.snoozeText
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.snoozeRequested()
    }

    AccentButton {
      visible: root.meetingUrl !== ""
      filled: root.joinable
      iconText: "󰕧"
      text: root.joinable || root.meetingHost === ""
        ? Strings.tr(root.language, "agenda.join")
        : root.meetingHost
      tooltipText: Strings.tr(root.language, "agenda.joinHost", [root.meetingHost || root.item.displayTitle || ""])
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.joinRequested()
    }
  }
}
