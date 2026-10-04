import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// Google's "more options", folded by default: notifications, busy or free,
// visibility, colour and guest permissions. It reads the form and emits a
// patch; EventForm merges it.
Column {
  id: root

  property var form: ({})
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  // The colour the event shows with no colorId: its calendar's.
  property color calendarColor: "transparent"

  signal edited(var patch)

  property bool expanded: false
  readonly property bool compact: root.width < Style.space(360)
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  spacing: Style.space(6)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function patch(key, value) {
    var p = {}
    p[key] = value
    root.edited(p)
  }

  // A labelled row: the label at the left and the control at the right, or
  // the label above a full-width control when `stacked`. The label wraps
  // rather than running under the control.
  component OptionRow: Item {
    id: optionRow
    property string label: ""
    property bool stacked: root.compact
    property real controlWidth: Math.min(width * 0.55, Style.space(220))
    default property alias control: slot.data

    readonly property real gap: Style.space(stacked ? 2 : 8)

    width: root.width
    height: stacked
      ? rowLabel.height + gap + slot.height
      : Math.max(rowLabel.height, slot.height)

    Text {
      id: rowLabel
      width: optionRow.stacked ? optionRow.width : optionRow.width - slot.width - optionRow.gap
      y: optionRow.stacked ? 0 : (optionRow.height - height) / 2
      text: optionRow.label
      wrapMode: Text.WordWrap
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Item {
      id: slot
      x: optionRow.width - width
      y: optionRow.stacked ? rowLabel.height + optionRow.gap : (optionRow.height - height) / 2
      width: optionRow.stacked ? optionRow.width : optionRow.controlWidth
      height: childrenRect.height
    }
  }

  component OptionMenu: Dropdown {
    width: parent.width
    showLabel: false
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  Text {
    text: (root.expanded ? "▾ " : "▸ ") + root.tr("options.more")
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.bold: true
    font.letterSpacing: 1
    font.capitalization: Font.AllUppercase

    TapHandler { onTapped: root.expanded = !root.expanded }
    HoverHandler { cursorShape: Qt.PointingHandCursor }
  }

  Column {
    width: parent.width
    spacing: Style.space(6)
    visible: root.expanded

    OptionRow {
      label: root.tr("options.notification")
      OptionMenu {
        value: Model.reminderChoice(root.form.reminders)
        options: Model.reminderOptions(root.form.reminders, root.language)
        // "custom" stands for reminders the menu cannot express; they are
        // sent back untouched.
        onChanged: function(value) {
          if (value !== "custom") root.patch("reminders", Model.remindersFor(value))
        }
      }
    }

    OptionRow {
      label: root.tr("options.showAs")
      OptionMenu {
        value: root.form.busy === false ? "free" : "busy"
        options: [
          { value: "busy", label: root.tr("options.busy") },
          { value: "free", label: root.tr("options.free") }
        ]
        onChanged: function(value) { root.patch("busy", value === "busy") }
      }
    }

    OptionRow {
      label: root.tr("options.visibility")
      OptionMenu {
        value: root.form.visibility || "default"
        options: [
          { value: "default", label: root.tr("options.visibilityDefault") },
          { value: "public", label: root.tr("options.public") },
          { value: "private", label: root.tr("options.private") }
        ]
        onChanged: function(value) { root.patch("visibility", value) }
      }
    }

    OptionRow {
      label: root.tr("options.colour")
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
      model: ["guestsCanModify", "guestsCanInviteOthers", "guestsCanSeeOtherGuests"]

      OptionRow {
        required property string modelData
        label: root.tr("options." + modelData)
        stacked: false
        controlWidth: permissionToggle.implicitWidth

        ToggleSwitch {
          id: permissionToggle
          checked: root.form[modelData] === true
          foreground: root.foreground
          onToggled: root.patch(modelData, !(root.form[modelData] === true))
        }
      }
    }
  }
}
