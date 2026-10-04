import QtQuick
import qs.Commons

import "Strings.js" as Strings

// The Calendars section of Settings: one switch per calendar, with how many
// events it holds, then the kinds of events that stay out by default. A
// hidden calendar disappears from the panel and the bar alike.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property var calendars: []
  property var hiddenCalendars: []
  // { calendarId: number of events }
  property var counts: ({})
  property bool showWorkingLocation: false
  property bool hideDeclined: false

  signal calendarToggled(string calendarId)
  signal workingLocationToggled()
  signal hideDeclinedToggled()

  readonly property int hiddenCount: calendars.filter(function(calendar) {
    return hiddenCalendars.indexOf(String(calendar.id)) !== -1
  }).length

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  spacing: Style.space(8)

  SettingsCaption {
    foreground: root.foreground
    fontFamily: root.fontFamily
    text: root.tr("settings.calendarsShown")
    note: root.hiddenCount > 0
      ? root.calendars.length + " · " + Strings.trn(root.language, "settings.hiddenCalendars", root.hiddenCount)
      : String(root.calendars.length)
  }

  Text {
    visible: root.calendars.length === 0
    width: parent.width
    text: root.tr("settings.noCalendars")
    color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.50)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  Repeater {
    model: root.calendars

    ToggleRow {
      required property var modelData

      foreground: root.foreground
      fontFamily: root.fontFamily
      label: modelData.name
      swatch: modelData.color
      note: String(root.counts[modelData.id] || 0)
      checked: root.hiddenCalendars.indexOf(modelData.id) === -1
      onActivated: root.calendarToggled(modelData.id)
    }
  }

  Item { width: 1; height: Style.space(8) }

  SettingsCaption {
    foreground: root.foreground
    fontFamily: root.fontFamily
    text: root.tr("settings.alsoShow")
  }

  ToggleRow {
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.workingLocation")
    hint: root.tr("settings.workingLocationHint")
    checked: root.showWorkingLocation
    onActivated: root.workingLocationToggled()
  }

  ToggleRow {
    // Every row here reads "on means shown". Phrasing this one as "Hide ..."
    // inverted that and made the page contradict itself.
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.declined")
    hint: root.tr("settings.declinedHint")
    checked: !root.hideDeclined
    onActivated: root.hideDeclinedToggled()
  }
}
