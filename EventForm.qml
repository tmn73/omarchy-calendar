import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model

// The event form, laid out like Google's: title, start and end, repeat,
// guests, Meet, location, description, calendar, then "more options". It
// holds one `form` object in the spec's shape and emits it; Panel.qml runs
// the event command. Panel loads a fresh one per open, so nothing carries
// over from the last event.
Column {
  id: root

  property color foreground: "white"
  property string fontFamily: ""
  property string timeFormat: "HH:mm"
  property int weekStart: 1
  // The writable calendars, from the events file.
  property var calendars: []
  // People from your events, for the guest field (the file's guestSuggestions).
  property var guestSuggestions: []
  // The form to start from: from the event command's get, or a new one.
  property var initialForm: ({})
  property string errorText: ""
  property bool busy: false

  signal submitted(var form)
  signal canceled()

  property var form: ({})

  readonly property bool isEditing: String(root.form.eventId || "") !== ""
  readonly property color muted: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.68)
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)
  readonly property bool sameDay: root.form.startDate === root.form.endDate
  readonly property string calendarName: {
    for (var i = 0; i < root.calendars.length; i++)
      if (root.calendars[i].id === root.form.calendarId) return root.calendars[i].name
    return root.form.calendarId || ""
  }
  readonly property color calendarColor: {
    for (var i = 0; i < root.calendars.length; i++)
      if (root.calendars[i].id === root.form.calendarId) return root.calendars[i].color
    return "transparent"
  }

  spacing: Style.space(8)

  Component.onCompleted: {
    // A copy, so edits never reach the object the panel holds.
    root.form = JSON.parse(JSON.stringify(root.initialForm || {}))
    titleField.text = root.form.title || ""
    locationField.text = root.form.location || ""
    descriptionField.text = root.form.description || ""
    Qt.callLater(function() { titleField.forceActiveFocus() })
  }

  function update(patch) {
    var next = {}
    for (var key in root.form) next[key] = root.form[key]
    for (var changed in patch) next[changed] = patch[changed]
    root.form = next
  }

  function minutesOf(text) {
    var parts = String(text || "00:00").split(":")
    return Number(parts[0]) * 60 + Number(parts[1])
  }

  function clockOf(minutes) {
    var m = Math.max(0, Math.min(minutes, 24 * 60)) % (24 * 60)
    var h = Math.floor(m / 60)
    var rest = m % 60
    return (h < 10 ? "0" : "") + h + ":" + (rest < 10 ? "0" : "") + rest
  }

  function addDays(key, days) {
    var p = String(key).split("-")
    return Model.keyForDate(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days))
  }

  function daysBetween(fromKey, toKey) {
    var a = String(fromKey).split("-")
    var b = String(toKey).split("-")
    var ms = new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2])) - new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]))
    return Math.round(ms / 86400000)
  }

  // Moving the start moves the end with it, as Google does, so the event
  // keeps its length.
  function setStartDate(key) {
    var shift = root.daysBetween(root.form.startDate, key)
    root.update({ startDate: key, endDate: root.addDays(root.form.endDate, shift) })
  }

  function setEndDate(key) {
    root.update({ endDate: root.daysBetween(root.form.startDate, key) < 0 ? root.form.startDate : key })
  }

  function setStartTime(value) {
    if (!root.sameDay) {
      root.update({ startTime: value })
      return
    }
    var end = root.form.endTime === "00:00" ? 24 * 60 : root.minutesOf(root.form.endTime)
    var length = Math.max(15, end - root.minutesOf(root.form.startTime))
    root.update({ startTime: value, endTime: root.clockOf(root.minutesOf(value) + length) })
  }

  // The panel's own key handler is off while the form is open, so the form
  // owns Escape and Enter.
  function handleKey(event) {
    if (event.key === Qt.Key_Escape) {
      root.canceled()
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.submit()
      event.accepted = true
    }
  }

  function submit() {
    if (root.busy) return
    // An address typed but not confirmed with Enter still counts, as it
    // does in Google.
    var guests = Model.addGuest(root.form.guests || [], guestList.pendingText)
    if (guests !== root.form.guests) {
      root.update({ guests: guests })
      guestList.clearPending()
    }
    root.submitted(root.form)
  }

  // Leaving "All day" needs times. An all-day event has none, and a save
  // with empty times is refused, so start from the form's defaults.
  function toggleAllDay() {
    if (root.form.allDay === true && !root.form.startTime) {
      var times = Model.defaultFormTimes(root.form.startDate, new Date())
      root.update({ allDay: false, startTime: times.start, endTime: times.end })
    } else {
      root.update({ allDay: !(root.form.allDay === true) })
    }
  }

  // A labelled line: a fixed-width label, then the controls.
  component FieldRow: Row {
    property string label: ""
    width: root.width
    spacing: Style.space(6)

    Text {
      width: Style.space(64)
      anchors.verticalCenter: parent.verticalCenter
      text: parent.label
      color: root.muted
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  Text {
    width: parent.width
    text: root.isEditing ? qsTr("EDIT EVENT") : qsTr("NEW EVENT")
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
  }

  TextField {
    id: titleField
    width: parent.width
    placeholderText: qsTr("Add title")
    foreground: root.foreground
    font.family: root.fontFamily
    onTextEdited: root.update({ title: text })
    Keys.onPressed: function(event) { root.handleKey(event) }
  }

  Text {
    width: parent.width
    visible: root.isEditing && String(root.form.recurringEventId || "") !== ""
    text: qsTr("Part of a series. You choose this event or all events when you save.")
    wrapMode: Text.WordWrap
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }

  FieldRow {
    label: qsTr("Starts")

    DatePicker {
      width: root.form.allDay ? root.width - Style.space(70) : (root.width - Style.space(76)) * 0.55
      dateKey: root.form.startDate || ""
      weekStart: root.weekStart
      foreground: root.foreground
      fontFamily: root.fontFamily
      onPicked: function(key) { root.setStartDate(key) }
    }

    TimeDropdown {
      visible: !root.form.allDay
      width: (root.width - Style.space(76)) * 0.45
      value: root.form.startTime || ""
      timeFormat: root.timeFormat
      foreground: root.foreground
      fontFamily: root.fontFamily
      onChosen: function(value) { root.setStartTime(value) }
    }
  }

  FieldRow {
    label: qsTr("Ends")

    DatePicker {
      width: root.form.allDay ? root.width - Style.space(70) : (root.width - Style.space(76)) * 0.55
      dateKey: root.form.endDate || ""
      weekStart: root.weekStart
      foreground: root.foreground
      fontFamily: root.fontFamily
      onPicked: function(key) { root.setEndDate(key) }
    }

    TimeDropdown {
      visible: !root.form.allDay
      width: (root.width - Style.space(76)) * 0.45
      value: root.form.endTime || ""
      // On the same day, only times after the start, with the duration.
      fromMinutes: root.sameDay ? root.minutesOf(root.form.startTime) : -1
      timeFormat: root.timeFormat
      foreground: root.foreground
      fontFamily: root.fontFamily
      onChosen: function(value) { root.update({ endTime: value }) }
    }
  }

  FieldRow {
    label: qsTr("All day")
    ToggleSwitch {
      anchors.verticalCenter: parent.verticalCenter
      checked: root.form.allDay === true
      foreground: root.foreground
      onToggled: root.toggleAllDay()
    }
  }

  FieldRow {
    label: qsTr("Repeat")
    RepeatPicker {
      width: root.width - Style.space(70)
      dateKey: root.form.startDate || ""
      value: root.form.repeat || "none"
      hasCustom: (root.initialForm || {}).repeat === "custom"
      foreground: root.foreground
      fontFamily: root.fontFamily
      onChosen: function(value) { root.update({ repeat: value }) }
    }
  }

  GuestList {
    id: guestList
    width: parent.width
    guests: root.form.guests || []
    suggestions: root.guestSuggestions
    foreground: root.foreground
    fontFamily: root.fontFamily
    onEdited: function(guests) { root.update({ guests: guests }) }
    onEscaped: root.canceled()
  }

  FieldRow {
    label: qsTr("Meet")
    ToggleSwitch {
      anchors.verticalCenter: parent.verticalCenter
      checked: root.form.meet === true
      foreground: root.foreground
      onToggled: root.update({ meet: !(root.form.meet === true) })
    }
    Text {
      anchors.verticalCenter: parent.verticalCenter
      width: root.width - Style.space(130)
      // A Meet link from Google, or the promise of one on save.
      textFormat: Text.PlainText
      text: root.form.meet
        ? (root.form.meetUrl || qsTr("A Google Meet link is added on save"))
        : qsTr("Add Google Meet video conferencing")
      elide: Text.ElideRight
      color: root.faint
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  TextField {
    id: locationField
    width: parent.width
    placeholderText: qsTr("Add location")
    foreground: root.foreground
    font.family: root.fontFamily
    onTextEdited: root.update({ location: text })
    Keys.onPressed: function(event) { root.handleKey(event) }
  }

  // Several lines, so Enter makes a new line here and never saves.
  BorderSurface {
    width: parent.width
    height: Math.max(Style.space(56), descriptionField.contentHeight + Style.space(12))
    color: Style.controlFill(descriptionField.activeFocus, false, root.foreground, Color.accent)
    borderSpec: Border.controlSpec(descriptionField.activeFocus ? "focus" : "normal", root.foreground, Color.accent)
    radius: Style.cornerRadius

    TextEdit {
      id: descriptionField
      anchors.fill: parent
      anchors.margins: Style.space(6)
      wrapMode: TextEdit.Wrap
      textFormat: TextEdit.PlainText
      color: root.foreground
      selectionColor: Style.selectionFillFor(root.foreground, Color.accent)
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
      onTextChanged: if (activeFocus) root.update({ description: text })
      Keys.onEscapePressed: function(event) { root.canceled(); event.accepted = true }

      Text {
        visible: descriptionField.text === "" && !descriptionField.activeFocus
        text: qsTr("Add description")
        color: root.faint
        font: descriptionField.font
      }
    }
  }

  // Always say where the event goes. With one writable calendar there is
  // nothing to pick. On an edit there is nothing to pick either: moving an
  // event to another calendar needs Google's events.move, which the event
  // command does not do.
  FieldRow {
    label: qsTr("Calendar")
    visible: root.calendars.length <= 1 || root.isEditing

    Rectangle {
      anchors.verticalCenter: parent.verticalCenter
      width: Style.space(10)
      height: width
      radius: width / 2
      color: root.calendarColor
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      width: root.width - Style.space(90)
      textFormat: Text.PlainText
      text: root.calendarName
      elide: Text.ElideRight
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  Dropdown {
    width: parent.width
    visible: root.calendars.length > 1 && !root.isEditing
    label: qsTr("Calendar")
    value: root.form.calendarId || ""
    options: root.calendars.map(function(c) { return { value: c.id, label: c.name } })
    foreground: root.foreground
    fontFamily: root.fontFamily
    onChanged: function(value) { root.update({ calendarId: value }) }
  }

  EventOptions {
    width: parent.width
    form: root.form
    calendarColor: root.calendarColor
    foreground: root.foreground
    fontFamily: root.fontFamily
    onEdited: function(patch) { root.update(patch) }
  }

  // Can quote gws stderr, so never rich text.
  Text {
    width: parent.width
    visible: root.errorText !== ""
    text: root.errorText
    textFormat: Text.PlainText
    color: Color.urgent
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  Row {
    width: parent.width
    spacing: Style.space(8)
    layoutDirection: Qt.RightToLeft

    Button {
      text: root.busy ? qsTr("Saving…") : (root.isEditing ? qsTr("Save") : qsTr("Create"))
      bordered: true
      foreground: root.foreground
      fontFamily: root.fontFamily
      enabled: !root.busy
      onClicked: root.submit()
    }

    Button {
      text: qsTr("Cancel")
      foreground: root.muted
      fontFamily: root.fontFamily
      enabled: !root.busy
      onClicked: root.canceled()
    }
  }
}
