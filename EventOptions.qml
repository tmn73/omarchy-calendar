import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model

// Google's "more options", folded by default: notifications, busy or free,
// visibility, colour and guest permissions. It reads the form and emits a
// patch; EventForm merges it.
Column {
  id: root

  property var form: ({})
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  // The colour the event shows with no colorId: its calendar's.
  property color calendarColor: "transparent"

  signal edited(var patch)

  property bool expanded: false
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  spacing: Style.space(6)

  function patch(key, value) {
    var p = {}
    p[key] = value
    root.edited(p)
  }

  // A labelled row: the label at the left, the control at the right.
  component OptionRow: Item {
    property string label: ""
    default property alias control: slot.data
    width: root.width
    height: Math.max(rowLabel.implicitHeight, slot.childrenRect.height)

    Text {
      id: rowLabel
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      text: parent.label
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Item {
      id: slot
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      width: Math.min(parent.width * 0.55, Style.space(220))
      height: childrenRect.height
    }
  }

  Text {
    text: (root.expanded ? "▾ " : "▸ ") + qsTr("More options")
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.bold: true
    font.letterSpacing: 1

    TapHandler { onTapped: root.expanded = !root.expanded }
    HoverHandler { cursorShape: Qt.PointingHandCursor }
  }

  Column {
    width: parent.width
    spacing: Style.space(6)
    visible: root.expanded

    OptionRow {
      label: qsTr("Notification")
      Dropdown {
        width: parent.width
        showLabel: false
        value: Model.reminderChoice(root.form.reminders)
        options: {
          var list = [
            { value: "default", label: qsTr("Default") },
            { value: "none", label: qsTr("None") },
            { value: "5", label: qsTr("5 minutes before") },
            { value: "10", label: qsTr("10 minutes before") },
            { value: "30", label: qsTr("30 minutes before") },
            { value: "60", label: qsTr("1 hour before") },
            { value: "1440", label: qsTr("1 day before") }
          ]
          if (Model.reminderChoice(root.form.reminders) === "custom")
            list.push({ value: "custom", label: qsTr("Custom (kept as it is)") })
          return list
        }
        foreground: root.foreground
        fontFamily: root.fontFamily
        onChanged: function(value) {
          if (value !== "custom") root.patch("reminders", Model.remindersFor(value))
        }
      }
    }

    OptionRow {
      label: qsTr("Show as")
      Dropdown {
        width: parent.width
        showLabel: false
        value: root.form.busy === false ? "free" : "busy"
        options: [{ value: "busy", label: qsTr("Busy") }, { value: "free", label: qsTr("Free") }]
        foreground: root.foreground
        fontFamily: root.fontFamily
        onChanged: function(value) { root.patch("busy", value === "busy") }
      }
    }

    OptionRow {
      label: qsTr("Visibility")
      Dropdown {
        width: parent.width
        showLabel: false
        value: root.form.visibility || "default"
        options: [
          { value: "default", label: qsTr("Default visibility") },
          { value: "public", label: qsTr("Public") },
          { value: "private", label: qsTr("Private") }
        ]
        foreground: root.foreground
        fontFamily: root.fontFamily
        onChanged: function(value) { root.patch("visibility", value) }
      }
    }

    OptionRow {
      label: qsTr("Colour")
      Flow {
        width: parent.width
        spacing: Style.space(4)

        Repeater {
          model: [{ id: "", color: root.calendarColor }].concat(Model.EVENT_COLORS)

          Rectangle {
            required property var modelData
            readonly property bool chosen: (root.form.colorId || "") === modelData.id
            width: Style.space(16)
            height: width
            radius: width / 2
            color: modelData.color
            border.width: chosen ? Style.space(2) : 0
            border.color: root.foreground

            TapHandler { onTapped: root.patch("colorId", modelData.id) }
            HoverHandler { cursorShape: Qt.PointingHandCursor }
          }
        }
      }
    }

    Repeater {
      model: [
        { key: "guestsCanModify", label: qsTr("Guests can modify the event") },
        { key: "guestsCanInviteOthers", label: qsTr("Guests can invite others") },
        { key: "guestsCanSeeOtherGuests", label: qsTr("Guests can see the guest list") }
      ]

      OptionRow {
        required property var modelData
        label: modelData.label
        ToggleSwitch {
          anchors.right: parent.right
          checked: root.form[modelData.key] === true
          foreground: root.foreground
          onToggled: root.patch(modelData.key, !(root.form[modelData.key] === true))
        }
      }
    }
  }
}
