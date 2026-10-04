import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// The event form, laid out like Google's: title, start and end, repeat,
// guests, Meet, location, description, calendar, then "more options". It
// holds one `form` object in the spec's shape and emits it; Panel.qml runs
// the event command. Panel loads a fresh one per open, so nothing carries
// over from the last event.
//
// Width-adaptive: in a narrow column (the inspector) each label sits above
// its controls instead of beside them, and controls share the full width.
Column {
  id: root

  property color foreground: "white"
  property string fontFamily: ""
  property string language: "en"
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
  readonly property bool sameDay: root.form.startDate === root.form.endDate
  readonly property bool compact: root.width < Style.space(360)
  readonly property color muted: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.68)
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)
  readonly property var calendar: {
    for (var i = 0; i < root.calendars.length; i++)
      if (root.calendars[i].id === root.form.calendarId) return root.calendars[i]
    return { id: root.form.calendarId || "", name: root.form.calendarId || "", color: "transparent" }
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

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function update(patch) {
    var next = {}
    for (var key in root.form) next[key] = root.form[key]
    for (var changed in patch) next[changed] = patch[changed]
    root.form = next
  }

  // Moving the start moves the end with it, as Google does, so the event
  // keeps its length.
  function setStartDate(key) {
    var shift = Model.daysBetween(root.form.startDate, key)
    root.update({ startDate: key, endDate: Model.addDays(root.form.endDate, shift) })
  }

  function setEndDate(key) {
    root.update({ endDate: Model.daysBetween(root.form.startDate, key) < 0 ? root.form.startDate : key })
  }

  // Same-day events keep their length too, capped at midnight ("00:00"),
  // so a late start never wraps the end to before it.
  function setStartTime(value) {
    if (!root.sameDay) {
      root.update({ startTime: value })
      return
    }
    var dayEnd = 24 * 60
    var end = root.form.endTime === "00:00" ? dayEnd : Model.minutesOf(root.form.endTime)
    var length = Math.max(15, end - Model.minutesOf(root.form.startTime))
    root.update({ startTime: value, endTime: Model.clockText(Math.min(Model.minutesOf(value) + length, dayEnd)) })
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

  // A labelled line: the label beside the controls, or above them when the
  // form is narrow (unless `inline`, for a lone switch). Controls go in the
  // slot and size themselves from slotWidth.
  component FieldRow: Grid {
    id: fieldRow
    property string label: ""
    property bool inline: false
    default property alias content: slot.data
    readonly property bool stacked: root.compact && !inline
    readonly property real slotWidth: stacked ? width : width - Style.space(64) - columnSpacing

    width: root.width
    columns: stacked ? 1 : 2
    columnSpacing: Style.space(6)
    rowSpacing: Style.space(2)
    verticalItemAlignment: Grid.AlignVCenter

    Text {
      width: fieldRow.stacked ? fieldRow.width : Style.space(64)
      text: fieldRow.label
      wrapMode: Text.WordWrap
      color: root.muted
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }

    Flow {
      id: slot
      width: fieldRow.slotWidth
      spacing: Style.space(6)
    }
  }

  // A date and, unless all day, a time beside it.
  component DateTimeRow: FieldRow {
    id: dateTimeRow
    property string dateKey: ""
    property string time: ""
    property int fromMinutes: -1
    readonly property real dateWidth: root.form.allDay
      ? dateTimeRow.slotWidth
      : Math.floor((dateTimeRow.slotWidth - Style.space(6)) * (root.compact ? 0.5 : 0.55))

    signal datePicked(string key)
    signal timeChosen(string value)

    DatePicker {
      width: dateTimeRow.dateWidth
      dateKey: dateTimeRow.dateKey
      weekStart: root.weekStart
      language: root.language
      foreground: root.foreground
      fontFamily: root.fontFamily
      onPicked: function(key) { dateTimeRow.datePicked(key) }
    }

    TimeDropdown {
      id: timeMenu
      visible: !root.form.allDay
      width: Math.floor(dateTimeRow.slotWidth - dateTimeRow.dateWidth - Style.space(6))
      fromMinutes: dateTimeRow.fromMinutes
      timeFormat: root.timeFormat
      language: root.language
      foreground: root.foreground
      fontFamily: root.fontFamily
      onChosen: function(value) { dateTimeRow.timeChosen(value) }
    }

    // The shell's Dropdown assigns `value` on a pick, which would drop a
    // plain binding; this keeps the menu following the form when the start
    // time moves the end.
    Binding {
      target: timeMenu
      property: "value"
      value: dateTimeRow.time
    }
  }

  Text {
    width: parent.width
    text: root.isEditing ? root.tr("form.editEvent") : root.tr("form.newEvent")
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
    font.capitalization: Font.AllUppercase
  }

  TextField {
    id: titleField
    width: parent.width
    placeholderText: root.tr("form.titlePlaceholder")
    foreground: root.foreground
    font.family: root.fontFamily
    onTextEdited: root.update({ title: text })
    Keys.onPressed: function(event) { root.handleKey(event) }
  }

  Text {
    width: parent.width
    visible: root.isEditing && String(root.form.recurringEventId || "") !== ""
    text: root.tr("form.seriesNote")
    wrapMode: Text.WordWrap
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }

  DateTimeRow {
    label: root.tr("form.starts")
    dateKey: root.form.startDate || ""
    time: root.form.startTime || ""
    onDatePicked: function(key) { root.setStartDate(key) }
    onTimeChosen: function(value) { root.setStartTime(value) }
  }

  DateTimeRow {
    label: root.tr("form.ends")
    dateKey: root.form.endDate || ""
    time: root.form.endTime || ""
    // On the same day, only times after the start, with the duration.
    fromMinutes: root.sameDay ? Model.minutesOf(root.form.startTime) : -1
    onDatePicked: function(key) { root.setEndDate(key) }
    onTimeChosen: function(value) { root.update({ endTime: value }) }
  }

  FieldRow {
    label: root.tr("form.allDay")
    inline: true
    ToggleSwitch {
      checked: root.form.allDay === true
      foreground: root.foreground
      onToggled: root.toggleAllDay()
    }
  }

  FieldRow {
    id: repeatRow
    label: root.tr("form.repeat")
    RepeatPicker {
      width: repeatRow.slotWidth
      dateKey: root.form.startDate || ""
      value: root.form.repeat || "none"
      hasCustom: (root.initialForm || {}).repeat === "custom"
      language: root.language
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
    language: root.language
    foreground: root.foreground
    fontFamily: root.fontFamily
    onEdited: function(guests) { root.update({ guests: guests }) }
    onEscaped: root.canceled()
  }

  FieldRow {
    id: meetRow
    label: root.tr("form.meet")
    ToggleSwitch {
      id: meetToggle
      checked: root.form.meet === true
      foreground: root.foreground
      onToggled: root.update({ meet: !(root.form.meet === true) })
    }
    Text {
      width: Math.floor(meetRow.slotWidth - meetToggle.width - Style.space(6))
      height: meetToggle.height
      verticalAlignment: Text.AlignVCenter
      // A Meet link from Google, or the promise of one on save.
      textFormat: Text.PlainText
      text: root.form.meet
        ? (root.form.meetUrl || root.tr("form.meetOnSave"))
        : root.tr("form.meetAdd")
      wrapMode: Text.Wrap
      maximumLineCount: 2
      elide: Text.ElideRight
      color: root.faint
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  TextField {
    id: locationField
    width: parent.width
    placeholderText: root.tr("form.locationPlaceholder")
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
        width: parent.width
        visible: descriptionField.text === "" && !descriptionField.activeFocus
        text: root.tr("form.descriptionPlaceholder")
        wrapMode: Text.WordWrap
        color: root.faint
        font: descriptionField.font
      }
    }
  }

  // Always say where the event goes. There is a choice only for a new event
  // with several writable calendars: moving an existing event to another
  // calendar needs Google's events.move, which the event command does not do.
  FieldRow {
    id: calendarRow
    readonly property bool choosable: root.calendars.length > 1 && !root.isEditing
    label: root.tr("form.calendar")

    Dropdown {
      visible: calendarRow.choosable
      width: calendarRow.slotWidth
      showLabel: false
      value: root.form.calendarId || ""
      options: root.calendars.map(function(c) { return { value: c.id, label: c.name } })
      foreground: root.foreground
      fontFamily: root.fontFamily
      onChanged: function(value) { root.update({ calendarId: value }) }
    }

    Row {
      visible: !calendarRow.choosable
      width: calendarRow.slotWidth
      spacing: Style.space(6)

      Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(10)
        height: width
        radius: width / 2
        color: root.calendar.color
      }

      Text {
        width: parent.width - Style.space(16)
        textFormat: Text.PlainText
        text: root.calendar.name
        elide: Text.ElideRight
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }
  }

  EventOptions {
    width: parent.width
    form: root.form
    calendarColor: root.calendar.color
    language: root.language
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
      text: root.busy
        ? root.tr("form.saving")
        : root.tr(root.isEditing ? "form.save" : "form.create")
      bordered: true
      foreground: root.foreground
      fontFamily: root.fontFamily
      enabled: !root.busy
      onClicked: root.submit()
    }

    Button {
      text: root.tr("common.cancel")
      foreground: root.muted
      fontFamily: root.fontFamily
      enabled: !root.busy
      onClicked: root.canceled()
    }
  }
}
