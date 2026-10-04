import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// One event, in full: calendar and kind, the whole title, when it is and how
// far off, the meeting to join, where it is, its notes and its reminders,
// then what can be done with it. Every text here comes from the event, so
// all of it is plain text and every link has been through Model.safeUrl.
Column {
  id: root

  property var item: ({})
  property string whenText: ""
  property real nowMs: 0
  property bool editable: false
  property bool deletable: false
  property bool snoozable: false
  property string snoozeText: ""
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"

  signal closeRequested()
  signal editRequested()
  signal deleteRequested()
  signal joinRequested()
  signal snoozeRequested()
  signal linkOpened(string url)
  signal linkCopied(string url)

  readonly property string todoistUrl: "https://app.todoist.com/"
  readonly property bool fromTodoist: /todoist/i.test(String(item.calendarName || ""))
  readonly property string meetingUrl: Model.meetingUrlFor(item)
  readonly property string meetingHost: Model.meetingHost(meetingUrl)
  readonly property string eventUrl: Model.eventUrlFor(item)
  readonly property string location: {
    var place = String(root.item.location || "").trim()
    return place === root.meetingUrl ? "" : place
  }
  readonly property string mapsUrl: Model.safeUrl(Model.mapsUrl(location))
  readonly property bool soon: item.phase === "now"
    || (!item.allDay && item.phase === "later" && item.startMs - nowMs <= 15 * 60000)
  readonly property color muted: Util.alpha(foreground, 0.6)

  spacing: Style.space(14)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  // An icon down the left and its content beside it, as in the prototype.
  component DetailLine: Item {
    id: line
    property string icon: ""
    default property alias content: slot.data

    width: root.width
    height: Math.max(lineIcon.implicitHeight, slot.childrenRect.height)

    Text {
      id: lineIcon
      text: line.icon
      color: root.muted
      font.family: root.fontFamily
      font.pixelSize: Style.font.icon
    }

    Item {
      id: slot
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.leftMargin: Style.space(26)
      height: childrenRect.height
    }
  }

  Item {
    width: parent.width
    height: closeButton.height

    Row {
      anchors.left: parent.left
      anchors.right: closeButton.left
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(6)

      Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(7)
        height: width
        radius: width / 2
        color: root.item.color || root.foreground
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width - Style.space(14)
        textFormat: Text.PlainText
        text: (root.item.calendarName || "") + " · " + root.tr("kind." + (root.item.kind || "event"))
        elide: Text.ElideRight
        color: root.muted
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }

    PanelActionButton {
      id: closeButton
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      iconText: "󰅖"
      tooltipText: root.tr("insp.close")
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.closeRequested()
    }
  }

  TextEdit {
    width: parent.width
    readOnly: true
    selectByMouse: true
    textFormat: TextEdit.PlainText
    text: root.item.displayTitle || root.tr("common.noTitle")
    wrapMode: TextEdit.Wrap
    color: root.foreground
    selectionColor: Style.selectionFillFor(root.foreground, Color.accent)
    font.family: root.fontFamily
    font.pixelSize: Math.round(Style.font.heading * 1.25)
    font.bold: true
    font.strikeout: root.item.done === true
  }

  DetailLine {
    icon: "󰥔"

    Column {
      width: parent.width
      spacing: Style.space(3)

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: root.whenText
        wrapMode: Text.Wrap
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
      }

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: Model.relativeTime(root.item, root.nowMs, root.language, true)
        wrapMode: Text.Wrap
        color: root.soon ? Color.accent : root.muted
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        font.bold: true
      }
    }
  }

  Column {
    visible: root.meetingUrl !== ""
    width: parent.width
    spacing: Style.space(4)

    AccentButton {
      width: parent.width
      large: true
      iconText: "󰕧"
      text: root.meetingHost !== "" ? root.tr("insp.join", [root.meetingHost]) : root.tr("insp.joinMeeting")
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.joinRequested()
    }

    Item {
      width: parent.width
      height: copyButton.height

      Text {
        anchors.left: parent.left
        anchors.right: copyButton.left
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        textFormat: Text.PlainText
        text: root.meetingUrl.replace(/^https:\/\//, "")
        elide: Text.ElideMiddle
        color: root.muted
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }

      Button {
        id: copyButton
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        iconText: "󰆏"
        text: root.tr("insp.copyLink")
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.caption
        iconSize: Style.font.bodySmall
        verticalPadding: Style.space(3)
        onClicked: root.linkCopied(root.meetingUrl)
      }
    }
  }

  AccentButton {
    visible: root.snoozable
    filled: false
    iconText: "󰒲"
    text: root.snoozeText
    foreground: root.foreground
    fontFamily: root.fontFamily
    onClicked: root.snoozeRequested()
  }

  DetailLine {
    visible: root.location !== ""
    icon: "󰍎"

    Text {
      width: parent.width - (directions.visible ? directions.width + Style.space(6) : 0)
      textFormat: Text.PlainText
      text: root.location
      wrapMode: Text.Wrap
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
    }

    Text {
      id: directions
      visible: root.mapsUrl !== ""
      anchors.right: parent.right
      text: root.tr("insp.directions")
      color: directionsMouse.containsMouse ? Style.hoverStateColor(root.foreground, Color.accent) : Color.accent
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall

      MouseArea {
        id: directionsMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.linkOpened(root.mapsUrl)
      }
    }
  }

  DetailLine {
    visible: String(root.item.description || "") !== ""
    icon: "󰦨"

    TextEdit {
      width: parent.width
      readOnly: true
      selectByMouse: true
      textFormat: TextEdit.PlainText
      text: root.item.description || ""
      wrapMode: TextEdit.Wrap
      color: Util.alpha(root.foreground, 0.85)
      selectionColor: Style.selectionFillFor(root.foreground, Color.accent)
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  DetailLine {
    visible: root.item.kind !== "task"
    icon: "󰂚"

    Text {
      width: parent.width
      textFormat: Text.PlainText
      text: Model.reminderSummary(root.item, root.language)
      wrapMode: Text.Wrap
      color: Util.alpha(root.foreground, 0.85)
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  Text {
    visible: root.fromTodoist || (!root.editable && root.eventUrl !== "")
    width: parent.width
    text: root.tr(root.fromTodoist ? "insp.todoistNote" : "insp.readOnlyNote")
    wrapMode: Text.Wrap
    color: root.muted
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }

  Rectangle {
    width: parent.width
    height: Style.spacing.hairline
    color: Util.alpha(root.foreground, 0.1)
  }

  Row {
    width: parent.width
    spacing: Style.space(6)

    Button {
      visible: root.fromTodoist
      text: root.tr("insp.openInTodoist")
      bordered: true
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      onClicked: root.linkOpened(root.todoistUrl)
    }

    Button {
      visible: root.editable
      iconText: "󰏫"
      text: root.tr("insp.edit")
      bordered: true
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      onClicked: root.editRequested()
    }

    // Spelled out when it is the only way to change the event, an icon
    // beside Edit otherwise.
    Button {
      visible: root.eventUrl !== "" && !root.editable && !root.fromTodoist
      iconText: "󰏌"
      text: root.tr("insp.openInGoogle")
      bordered: true
      foreground: root.foreground
      fontFamily: root.fontFamily
      fontSize: Style.font.bodySmall
      onClicked: root.linkOpened(root.eventUrl)
    }

    PanelActionButton {
      visible: root.eventUrl !== "" && (root.editable || root.fromTodoist)
      anchors.verticalCenter: parent.verticalCenter
      iconText: "󰏌"
      tooltipText: root.tr("insp.openInGoogle")
      bordered: true
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.linkOpened(root.eventUrl)
    }

    PanelActionButton {
      visible: root.deletable
      anchors.verticalCenter: parent.verticalCenter
      iconText: "󰩺"
      tooltipText: root.tr("insp.delete")
      bordered: true
      foreground: root.foreground
      hoverColor: Color.urgent
      fontFamily: root.fontFamily
      onClicked: root.deleteRequested()
    }
  }
}
