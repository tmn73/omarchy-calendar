import QtQuick
import qs.Commons
import qs.Ui

// Create/edit form, shown in place of the grid like SettingsView. It reads
// state and emits intent; Panel.qml runs the write command and handles the
// reply.
Column {
  id: root

  property color foreground: "white"
  property string fontFamily: ""

  // null while creating; the agenda row being edited otherwise.
  property var editing: null
  property string defaultDateKey: ""
  property string defaultStart: "09:00"
  property string defaultEnd: "09:30"
  // The writable calendars, from the events file.
  property var calendars: []
  property string errorText: ""
  property bool busy: false

  // fields: {calendarId, title, dateKey, allDay, start, end, location}
  signal submitted(var fields)
  signal canceled()

  readonly property bool isEditing: root.editing !== null
  readonly property color muted: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.68)
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  spacing: Style.space(8)

  // Seeds the fields every time the form opens, from `editing` or from the
  // defaults. The form is one long-lived instance toggled by `visible`, so
  // it cannot rely on being created fresh.
  function reset() {
    var e = root.editing
    titleField.text = e ? String(e.title || "") : ""
    locationField.text = e ? String(e.location || "") : ""
    allDayToggle.checked = e ? !!e.allDay : false
    dateField.text = e ? String(e.dateKey || root.defaultDateKey) : root.defaultDateKey

    if (e && !e.allDay) {
      startField.text = Qt.formatDateTime(new Date(e.start), "HH:mm")
      endField.text = Qt.formatDateTime(new Date(e.end), "HH:mm")
    } else {
      startField.text = root.defaultStart
      endField.text = root.defaultEnd
    }

    var chosen = root.calendars.length ? String(root.calendars[0].id) : ""
    if (e) {
      for (var i = 0; i < root.calendars.length; i++)
        if (root.calendars[i].id === e.calendarId) chosen = String(root.calendars[i].id)
    }
    calendarPicker.value = chosen

    Qt.callLater(function() { titleField.forceActiveFocus() })
  }

  function submit() {
    root.submitted({
      calendarId: calendarPicker.value || (root.calendars.length ? root.calendars[0].id : ""),
      title: titleField.text,
      dateKey: dateField.text,
      allDay: allDayToggle.checked,
      start: startField.text,
      end: endField.text,
      location: locationField.text
    })
  }

  // The panel's own key handler is off while the form is open, so the form
  // owns Escape and Enter.
  function handleKey(event) {
    if (event.key === Qt.Key_Escape) {
      root.canceled()
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      if (!root.busy) root.submit()
      event.accepted = true
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
    placeholderText: qsTr("Title")
    foreground: root.foreground
    font.family: root.fontFamily
    Keys.onPressed: function(event) { root.handleKey(event) }
  }

  Text {
    width: parent.width
    visible: root.isEditing && root.editing.recurring === true
    text: qsTr("Changes this occurrence only")
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }

  // Only worth a choice when there is more than one calendar to write to.
  Dropdown {
    id: calendarPicker
    width: parent.width
    visible: root.calendars.length > 1
    label: qsTr("Calendar")
    options: root.calendars.map(function(c) { return { value: c.id, label: c.name } })
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  Row {
    width: parent.width
    spacing: Style.space(6)

    TextField {
      id: dateField
      width: (parent.width - Style.space(6)) / 2
      placeholderText: qsTr("YYYY-MM-DD")
      foreground: root.foreground
      font.family: root.fontFamily
      Keys.onPressed: function(event) { root.handleKey(event) }
    }

    Item {
      width: (parent.width - Style.space(6)) / 2
      height: allDayLabel.implicitHeight

      Text {
        id: allDayLabel
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: qsTr("All day")
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      ToggleSwitch {
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        checked: allDayToggle.checked
        foreground: root.foreground
        onToggled: allDayToggle.checked = !allDayToggle.checked
      }

      // Holds the value only, so the label and the switch can both read it
      // without either owning it.
      QtObject {
        id: allDayToggle
        property bool checked: false
      }
    }
  }

  Row {
    width: parent.width
    spacing: Style.space(6)
    visible: !allDayToggle.checked

    TextField {
      id: startField
      width: (parent.width - Style.space(6)) / 2
      placeholderText: qsTr("Start, e.g. 09:00")
      foreground: root.foreground
      font.family: root.fontFamily
      Keys.onPressed: function(event) { root.handleKey(event) }
    }

    TextField {
      id: endField
      width: (parent.width - Style.space(6)) / 2
      placeholderText: qsTr("End, e.g. 09:30")
      foreground: root.foreground
      font.family: root.fontFamily
      Keys.onPressed: function(event) { root.handleKey(event) }
    }
  }

  TextField {
    id: locationField
    width: parent.width
    placeholderText: qsTr("Location (optional)")
    foreground: root.foreground
    font.family: root.fontFamily
    Keys.onPressed: function(event) { root.handleKey(event) }
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
