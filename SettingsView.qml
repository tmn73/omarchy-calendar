import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// The calendar's settings page: a header with the way back, the sections
// down the left, and one section at a time on the right, scrolling inside a
// fixed height so the panel keeps its size from one section to the next.
// It reads state and emits intent; the panel owns every value and is the
// only writer of shell.json.
Item {
  id: root

  property color foreground: "white"
  property string fontFamily: ""
  // The resolved display language ("en" | "pt").
  property string language: "en"
  property string section: "panel"

  // Panel
  // Model.layoutFromSettings
  property var layout: ({})

  // Bar
  property int announceLeadMinutes: 15
  property string duringEvent: "untilEnd"
  property string nextDuringEvent: "announce"
  property bool reminders: true

  // Calendars
  property var calendars: []
  property var hiddenCalendars: []
  property var calendarCounts: ({})
  property bool showWorkingLocation: false
  property bool hideDeclined: false

  // General
  // The stored setting ("auto" | "en" | "pt"), not the resolved language.
  property string languageSetting: "auto"
  property bool weekStartsMonday: true
  property bool canWrite: false
  property bool writeSetupCopied: false
  property string syncedAt: ""
  property string sourceLabel: ""
  property int eventCount: 0
  property string syncState: "missing"
  property string setupCommand: ""
  property bool setupCommandCopied: false

  signal closeRequested()
  // The settings to store as they are, for example { reminders: false }.
  signal picked(var values)
  signal calendarToggled(string calendarId)
  signal workingLocationToggled()
  signal hideDeclinedToggled()
  signal weekStartToggled()
  signal languagePicked(string value)
  signal setupCommandCopyRequested()
  signal writeSetupCopyRequested()

  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)
  readonly property int visibleCalendars: calendars.filter(function(calendar) {
    return hiddenCalendars.indexOf(String(calendar.id)) === -1
  }).length
  readonly property var sections: [
    { id: "panel", icon: "󰕭", label: "settings.sectionPanel" },
    { id: "bar", icon: "󰅐", label: "settings.sectionBar" },
    { id: "calendars", icon: "󰃭", label: "settings.calendars" },
    { id: "general", icon: "󰒓", label: "settings.sectionGeneral" }
  ]

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  implicitHeight: Style.space(500)

  // A new section starts at its top.
  onSectionChanged: content.contentY = 0

  Item {
    id: header
    width: parent.width
    height: backButton.height

    SecondaryButton {
      id: backButton
      iconText: "󰅁"
      tooltipText: root.tr("nav.backToCalendar")
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.closeRequested()
    }

    Text {
      anchors.left: backButton.right
      anchors.leftMargin: Style.space(10)
      anchors.verticalCenter: parent.verticalCenter
      text: root.tr("nav.settings")
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.heading
      font.bold: true
    }

    Text {
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: root.tr("layout.saved")
      color: root.faint
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  Column {
    id: nav
    anchors.top: header.bottom
    anchors.topMargin: Style.space(16)
    anchors.left: parent.left
    width: Style.space(140)
    spacing: Style.space(2)

    Repeater {
      model: root.sections

      Rectangle {
        id: navItem
        required property var modelData
        readonly property bool current: modelData.id === root.section

        width: nav.width
        height: Style.space(30)
        radius: Style.cornerRadius
        color: current
          ? Util.alpha(root.foreground, 0.10)
          : navMouse.containsMouse ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"

        Text {
          id: navIcon
          anchors.left: parent.left
          anchors.leftMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          text: navItem.modelData.icon
          color: navItem.current ? root.foreground : root.faint
          font.family: root.fontFamily
          font.pixelSize: Style.font.icon
        }

        Text {
          anchors.left: navIcon.right
          anchors.leftMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          text: root.tr(navItem.modelData.label)
          color: navItem.current ? root.foreground : Util.alpha(root.foreground, 0.75)
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          font.bold: navItem.current
        }

        Text {
          visible: navItem.modelData.id === "calendars" && root.calendars.length > 0
          anchors.right: parent.right
          anchors.rightMargin: Style.space(8)
          anchors.verticalCenter: parent.verticalCenter
          text: String(root.visibleCalendars)
          color: root.faint
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        MouseArea {
          id: navMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: root.section = navItem.modelData.id
        }
      }
    }
  }

  Rectangle {
    id: divider
    anchors.left: nav.right
    anchors.leftMargin: Style.space(12)
    anchors.top: nav.top
    anchors.bottom: parent.bottom
    width: Style.spacing.hairline
    color: Util.alpha(root.foreground, 0.10)
  }

  Flickable {
    id: content
    anchors.left: divider.right
    anchors.leftMargin: Style.space(16)
    anchors.right: parent.right
    anchors.top: nav.top
    anchors.bottom: parent.bottom
    contentWidth: width
    contentHeight: sectionColumn.implicitHeight
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height

    // One section shows at a time; the hidden ones take no room.
    Column {
      id: sectionColumn
      // Room on the right for the scroll thumb.
      width: content.width - Style.space(10)

      LayoutOptions {
        visible: root.section === "panel"
        width: parent.width
        foreground: root.foreground
        fontFamily: root.fontFamily
        language: root.language
        layout: root.layout
        showHints: true
        onLayoutPicked: function(values) { root.picked(values) }
      }

      BarSettings {
        visible: root.section === "bar"
        width: parent.width
        foreground: root.foreground
        fontFamily: root.fontFamily
        language: root.language
        leadMinutes: root.announceLeadMinutes
        duringEvent: root.duringEvent
        nextDuringEvent: root.nextDuringEvent
        reminders: root.reminders
        onPicked: function(values) { root.picked(values) }
      }

      CalendarSettings {
        visible: root.section === "calendars"
        width: parent.width
        foreground: root.foreground
        fontFamily: root.fontFamily
        language: root.language
        calendars: root.calendars
        hiddenCalendars: root.hiddenCalendars
        counts: root.calendarCounts
        showWorkingLocation: root.showWorkingLocation
        hideDeclined: root.hideDeclined
        onCalendarToggled: function(calendarId) { root.calendarToggled(calendarId) }
        onWorkingLocationToggled: root.workingLocationToggled()
        onHideDeclinedToggled: root.hideDeclinedToggled()
      }

      GeneralSettings {
        visible: root.section === "general"
        width: parent.width
        foreground: root.foreground
        fontFamily: root.fontFamily
        language: root.language
        languageSetting: root.languageSetting
        weekStartsMonday: root.weekStartsMonday
        canWrite: root.canWrite
        writeSetupCopied: root.writeSetupCopied
        syncState: root.syncState
        setupCommand: root.setupCommand
        setupCommandCopied: root.setupCommandCopied
        eventCount: root.eventCount
        sourceLabel: root.sourceLabel
        syncedAt: root.syncedAt
        onLanguagePicked: function(value) { root.languagePicked(value) }
        onWeekStartToggled: root.weekStartToggled()
        onWriteSetupCopyRequested: root.writeSetupCopyRequested()
        onSetupCommandCopyRequested: root.setupCommandCopyRequested()
      }
    }
  }

  ScrollHint {
    anchors.fill: content
    flickable: content
    foreground: root.foreground
  }
}
