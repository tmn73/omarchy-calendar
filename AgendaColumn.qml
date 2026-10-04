import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// The middle column: quick add and the next-up card at the top, then the
// selected day (all-day items, timed events, the days after it) scrolling
// under them, and a toast over the bottom edge. Everything it shows is
// handed in by the panel; everything it does is a signal back.
Item {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property string timeFormat: "HH:mm"
  property real nowMs: 0
  property string todayKey: ""
  property bool isToday: false
  property bool canWrite: false
  property bool busy: false

  property string dayHeading: ""
  property string daySummary: ""
  // Model.daySections for the selected day.
  property var sections: ({ allDay: [], timed: [], nowIndex: -1 })
  property var upcoming: []
  property var nextUp: null
  property string selectedId: ""
  property bool selectedSnoozable: false
  property bool nextUpSnoozable: false
  property string snoozeText: ""

  property string syncState: "ok"
  property string setupCommand: ""
  property bool setupCommandCopied: false

  property string quickPreviewTitle: ""
  property string quickPreviewWhen: ""
  property alias quickText: quickAdd.text

  property string toastText: ""
  property bool toastError: false

  signal itemSelected(var item)
  signal itemActivated(var item)
  signal joinRequested(var item)
  signal snoozeRequested(var item)
  signal daySelected(string key)
  signal quickSubmitted(bool moreOptions)
  signal quickEscaped()
  signal newEventRequested()
  signal setupCopyRequested()
  signal toastDismissed()

  readonly property bool empty: sections.allDay.length === 0 && sections.timed.length === 0
  readonly property string nowText: Qt.formatDateTime(new Date(nowMs), timeFormat)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function focusQuickAdd() {
    quickAdd.focusField()
  }

  function clearQuickAdd() {
    quickAdd.clear()
  }

  component SectionLabel: Text {
    color: Util.alpha(root.foreground, 0.6)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
  }

  Column {
    id: header
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    spacing: Style.space(10)

    QuickAdd {
      id: quickAdd
      width: parent.width
      foreground: root.foreground
      fontFamily: root.fontFamily
      language: root.language
      previewTitle: root.quickPreviewTitle
      previewWhen: root.quickPreviewWhen
      onSubmitted: function(moreOptions) { root.quickSubmitted(moreOptions) }
      onEscaped: root.quickEscaped()
    }

    NextUpCard {
      width: parent.width
      item: root.nextUp
      nowMs: root.nowMs
      timeFormat: root.timeFormat
      snoozable: root.nextUpSnoozable
      snoozeText: root.snoozeText
      foreground: root.foreground
      fontFamily: root.fontFamily
      language: root.language
      onOpened: root.itemSelected(root.nextUp)
      onJoinRequested: root.joinRequested(root.nextUp)
      onSnoozeRequested: root.snoozeRequested(root.nextUp)
    }
  }

  Flickable {
    id: scroll
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: header.bottom
    anchors.bottom: parent.bottom
    anchors.topMargin: Style.space(14)
    contentWidth: width
    contentHeight: dayColumn.implicitHeight + (toast.visible ? toast.height + Style.space(12) : 0)
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height

    Column {
      id: dayColumn
      width: scroll.width
      spacing: Style.space(14)

      Column {
        width: parent.width
        spacing: Style.space(3)

        SectionLabel {
          width: parent.width
          textFormat: Text.PlainText
          text: root.dayHeading.toUpperCase()
          wrapMode: Text.Wrap
          color: Util.alpha(root.foreground, 0.85)
        }

        Text {
          width: parent.width
          text: root.busy ? root.tr("agenda.loading") : root.daySummary
          wrapMode: Text.Wrap
          color: Util.alpha(root.foreground, 0.6)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      // An empty day and a sync that never ran look identical unless we
      // say which one it is.
      Rectangle {
        visible: root.empty
        width: parent.width
        height: emptyText.implicitHeight + Style.space(14) * 2
        radius: Style.cornerRadius
        color: emptyMouse.containsMouse && root.syncState === "missing"
          ? Style.hoverFillFor(root.foreground, Color.accent)
          : "transparent"
        border.width: Style.spacing.hairline
        border.color: Util.alpha(root.foreground, 0.2)

        Text {
          id: emptyText
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          anchors.margins: Style.space(14)
          textFormat: Text.PlainText
          wrapMode: Text.Wrap
          color: Util.alpha(root.foreground, 0.6)
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          text: {
            if (root.syncState === "missing")
              return root.tr(root.setupCommandCopied ? "sync.copied" : "sync.missingPanel", [root.setupCommand])
            if (root.syncState === "version") return root.tr("sync.versionPanel")
            if (root.syncState === "stale") return root.tr("sync.stalePanel")
            return root.tr(root.canWrite ? "agenda.empty" : "agenda.emptyReadOnly")
          }
        }

        MouseArea {
          id: emptyMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: root.syncState === "missing" ? Qt.PointingHandCursor : Qt.ArrowCursor
          onClicked: if (root.syncState === "missing") root.setupCopyRequested()
          onDoubleClicked: if (root.canWrite && root.syncState !== "missing") root.newEventRequested()
        }
      }

      Column {
        visible: root.sections.allDay.length > 0
        width: parent.width
        spacing: Style.space(2)

        SectionLabel {
          bottomPadding: Style.space(4)
          text: root.tr("agenda.allDay").toUpperCase() + " · " + root.sections.allDay.length
        }

        Repeater {
          model: root.sections.allDay

          AllDayRow {
            required property var modelData
            width: parent.width
            item: modelData
            selected: modelData.id === root.selectedId
            snoozable: selected && root.selectedSnoozable
            snoozeText: root.snoozeText
            foreground: root.foreground
            fontFamily: root.fontFamily
            language: root.language
            onClicked: root.itemSelected(modelData)
            onDoubleClicked: root.itemActivated(modelData)
            onSnoozeRequested: root.snoozeRequested(modelData)
          }
        }
      }

      Column {
        visible: root.sections.timed.length > 0
        width: parent.width
        spacing: Style.space(2)

        SectionLabel {
          bottomPadding: Style.space(4)
          text: root.tr("agenda.timed").toUpperCase()
        }

        Repeater {
          model: root.sections.timed

          Column {
            id: timedEntry
            required property var modelData
            required property int index
            width: parent.width
            spacing: Style.space(2)

            NowLine {
              visible: timedEntry.index === root.sections.nowIndex
              width: parent.width
              timeText: root.nowText
              fontFamily: root.fontFamily
            }

            TimedRow {
              width: parent.width
              item: timedEntry.modelData
              selected: timedEntry.modelData.id === root.selectedId
              snoozable: selected && root.selectedSnoozable
              snoozeText: root.snoozeText
              isToday: root.isToday
              nowMs: root.nowMs
              todayKey: root.todayKey
              timeFormat: root.timeFormat
              foreground: root.foreground
              fontFamily: root.fontFamily
              language: root.language
              onClicked: root.itemSelected(timedEntry.modelData)
              onDoubleClicked: root.itemActivated(timedEntry.modelData)
              onJoinRequested: root.joinRequested(timedEntry.modelData)
              onSnoozeRequested: root.snoozeRequested(timedEntry.modelData)
            }
          }
        }

        NowLine {
          visible: root.sections.nowIndex === root.sections.timed.length
          width: parent.width
          timeText: root.nowText
          fontFamily: root.fontFamily
        }
      }

      Rectangle {
        visible: upcomingDays.visible
        width: parent.width
        height: Style.spacing.hairline
        color: Util.alpha(root.foreground, 0.1)
      }

      UpcomingDays {
        id: upcomingDays
        width: parent.width
        days: root.upcoming
        timeFormat: root.timeFormat
        foreground: root.foreground
        fontFamily: root.fontFamily
        language: root.language
        onDaySelected: function(key) { root.daySelected(key) }
        onItemSelected: function(item) { root.itemSelected(item) }
        onItemActivated: function(item) { root.itemActivated(item) }
        onJoinRequested: function(item) { root.joinRequested(item) }
      }
    }
  }

  Toast {
    id: toast
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    text: root.toastText
    error: root.toastError
    foreground: root.foreground
    fontFamily: root.fontFamily
    language: root.language
    onDismissed: root.toastDismissed()
  }
}
