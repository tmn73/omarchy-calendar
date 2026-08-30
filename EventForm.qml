import QtQuick
import qs.Commons
import qs.Ui

// Create/edit form, shown in place of the month grid the same way
// SettingsView is. Same split as that file: this reads state and emits
// intent, Panel.qml owns the actual gws call and what happens with its
// result.
Column {
  id: root

  property color foreground: "white"
  property string fontFamily: ""

  // null while creating; the event object being edited otherwise.
  property var editing: null
  property string defaultDateKey: ""
  property var calendars: []
  property string errorText: ""
  property bool busy: false

  // (fields, calendarId, calendarName, calendarColor)
  signal submitted(var fields, string calendarId, string calendarName, string calendarColor)
  signal canceled()

  readonly property bool isEditing: root.editing !== null
  readonly property color muted: Qt.darker(foreground, 1.5)
  readonly property color faint: Qt.darker(foreground, 1.9)

  spacing: Style.space(8)

  // (Re)seeds the fields from `editing`, or blank defaults for a new event,
  // every time the form opens -- rather than once at creation, since this
  // component is a single long-lived instance toggled by `visible`, not
  // recreated per open.
  function reset() {
    var e = root.editing
    titleField.text = e ? String(e.title || "") : ""
    locationField.text = e ? String(e.location || "") : ""
    allDayToggle.checked = e ? !!e.allDay : false

    if (e) {
      dateField.text = String(e.dateKey || root.defaultDateKey)
      if (!e.allDay) {
        var start = new Date(e.start)
        var end = new Date(e.end)
        startField.text = Qt.formatDateTime(start, "HH:mm")
        endField.text = Qt.formatDateTime(end, "HH:mm")
      } else {
        startField.text = ""
        endField.text = ""
      }
      var idx = 0
      for (var i = 0; i < root.calendars.length; i++) {
        if (root.calendars[i].id === e.calendarId) { idx = i; break }
      }
      calendarPicker.value = root.calendars.length ? String(root.calendars[idx].id) : ""
    } else {
      dateField.text = root.defaultDateKey
      startField.text = ""
      endField.text = ""
      calendarPicker.value = root.calendars.length ? String(root.calendars[0].id) : ""
    }
  }

  onVisibleChanged: if (root.visible) root.reset()

  function submit() {
    var chosenId = calendarPicker.value
    var chosen = null
    for (var i = 0; i < root.calendars.length; i++) {
      if (root.calendars[i].id === chosenId) { chosen = root.calendars[i]; break }
    }
    if (!chosen) chosen = { id: "primary", name: "primary", color: "" }

    root.submitted({
      title: titleField.text,
      location: locationField.text,
      allDay: allDayToggle.checked,
      dateKey: dateField.text,
      endDateKey: dateField.text,
      startTime: startField.text,
      endTime: endField.text
    }, chosen.id, chosen.name, chosen.color)
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
  }

  Dropdown {
    id: calendarPicker
    width: parent.width
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

      // Not a visual element -- just holds the checked state, so the label
      // and the switch above can both read/drive the same value without
      // either owning it.
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
    }

    TextField {
      id: endField
      width: (parent.width - Style.space(6)) / 2
      placeholderText: qsTr("End, e.g. 09:30")
      foreground: root.foreground
      font.family: root.fontFamily
    }
  }

  TextField {
    id: locationField
    width: parent.width
    placeholderText: qsTr("Location (optional)")
    foreground: root.foreground
    font.family: root.fontFamily
  }

  Text {
    width: parent.width
    visible: root.errorText !== ""
    text: root.errorText
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
