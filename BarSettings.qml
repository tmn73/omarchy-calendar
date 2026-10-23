import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// The Bar section of Settings: the user's own clock format, what the bar
// shows before and during an event, and the desktop reminders. A preview
// puts the event choices in words. It reads the values and emits the
// settings to store.
Column {
  id: root

  property color foreground: Commons.Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property int leadMinutes: 15
  // "untilEnd" | "firstMinutes"
  property string duringEvent: "untilEnd"
  // "announce" | "keep"
  property string nextDuringEvent: "announce"
  property bool reminders: true
  property bool reminderDetails: false
  // The bar's current format, and the user's own one ("" when unset).
  property string clockFormat: "dddd HH:mm"
  property string customFormat: ""

  // The settings to store, for example { duringEvent: "firstMinutes" }.
  signal picked(var values)
  // The format field let go of the keys.
  signal editingFinished()

  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)
  readonly property var presets: Model.clockFormats(false)
  readonly property string typedPreset: Model.presetClockFormat(formatField.text, presets)
  // The formats right click walks, as the bar would show them now. Spaces
  // inside a format do not break, so a line only wraps between two formats.
  readonly property string ring: Model.clockFormatRing("", "", presets, customFormat)
    .map(function(format) { return root.render(format).replace(/ /g, " ") })
    .join("  ›  ")
  // Fixed while the page is open: the examples need not tick.
  readonly property date sampleDate: new Date()
  // The preview counts down from 5 minutes, or less with a shorter lead.
  readonly property int previewMinutes: Math.min(5, leadMinutes)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function pick(key, value) {
    var values = {}
    values[key] = value
    root.picked(values)
  }

  // A format as the bar label renders it, ISO week included.
  function render(format) {
    var d = root.sampleDate
    var week = Model.isoWeekLiteral(d.getFullYear(), d.getMonth(), d.getDate())
    return Qt.locale(Strings.localeName(root.language)).toString(d, String(format).replace(/ww/g, week))
  }

  // The field text stays as typed while it has focus, even when it names a
  // preset and the stored custom format goes back to "", so it never empties
  // under the user's fingers. It takes the stored value again on the way out.
  function commitFormat() {
    saveTimer.stop()
    if (formatField.text.trim() !== root.customFormat || root.typedPreset !== "")
      root.picked(Model.customClockFormatValues(formatField.text, root.customFormat, root.clockFormat, root.presets, "dddd HH:mm"))
    if (!formatField.activeFocus) formatField.text = Qt.binding(function() { return root.customFormat })
  }

  // Saved a moment after the last key, like every other setting here.
  Timer {
    id: saveTimer
    interval: 600
    onTriggered: root.commitFormat()
  }

  spacing: Style.space(8)

  SettingsCaption {
    foreground: root.foreground
    fontFamily: root.fontFamily
    text: root.tr("settings.clockFormat")
  }

  Text {
    width: parent.width
    text: root.tr("settings.clockFormatHint")
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  Row {
    width: parent.width
    spacing: Style.space(10)

    // Saved as you type. Enter and Escape give the keys back to the panel.
    TextField {
      id: formatField
      width: Math.round(parent.width * 0.45)
      anchors.verticalCenter: parent.verticalCenter
      text: root.customFormat
      placeholderText: "dddd d MMM HH:mm"
      foreground: root.foreground
      font.family: root.fontFamily
      onTextEdited: saveTimer.restart()
      onEditingFinished: root.commitFormat()
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) {
          root.editingFinished()
          event.accepted = true
        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
          root.editingFinished()
          event.accepted = true
        }
      }
    }

    Text {
      width: parent.width - formatField.width - parent.spacing
      anchors.verticalCenter: parent.verticalCenter
      visible: formatField.text.trim() !== ""
      textFormat: Text.PlainText
      text: "→ " + root.render(formatField.text.trim())
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      font.bold: true
      elide: Text.ElideRight
    }
  }

  Text {
    width: parent.width
    textFormat: Text.PlainText
    text: ["dddd", "ddd", "d MMM", "HH:mm", "h:mm AP"].map(function(format) {
      return format + " " + root.render(format)
    }).join("  ·  ")
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  Rectangle {
    visible: root.typedPreset !== ""
    width: parent.width
    height: builtIn.implicitHeight + Style.space(8) * 2
    radius: Style.cornerRadius
    color: Util.alpha(Commons.Color.accent, 0.12)
    border.width: Style.spacing.hairline
    border.color: Util.alpha(Commons.Color.accent, 0.60)

    Text {
      id: builtIn
      x: Style.space(12)
      y: Style.space(8)
      width: parent.width - Style.space(24)
      text: root.tr("settings.clockFormatBuiltIn")
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }
  }

  Row {
    width: parent.width
    spacing: Style.space(8)

    KeyCap {
      id: rightClick
      anchors.verticalCenter: parent.verticalCenter
      foreground: root.foreground
      fontFamily: root.fontFamily
      text: root.tr("settings.rightClick")
    }

    Text {
      width: parent.width - rightClick.width - parent.spacing
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.ring
      color: root.faint
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }
  }

  Gap {}

  component Gap: Item { width: 1; height: Style.space(8) }

  component PreviewLine: Row {
    property string when: ""
    property string shows: ""
    property color showsColor: root.foreground

    spacing: Style.space(10)

    Text {
      width: Style.space(90)
      text: parent.when
      color: root.faint
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }

    Text {
      textFormat: Text.PlainText
      text: parent.shows
      color: parent.showsColor
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  SettingsCaption {
    foreground: root.foreground
    fontFamily: root.fontFamily
    text: root.tr("settings.barPreview")
  }

  Rectangle {
    width: parent.width
    height: preview.implicitHeight + Style.space(10) * 2
    radius: Style.cornerRadius
    color: Util.alpha(root.foreground, 0.04)
    border.width: Style.spacing.hairline
    border.color: Util.alpha(root.foreground, 0.10)

    Column {
      id: preview
      x: Style.space(12)
      y: Style.space(10)
      width: parent.width - Style.space(24)
      spacing: Style.space(4)

      // A lead of 0 gives the bar back to the clock, before and during.
      PreviewLine {
        when: root.leadMinutes > 0 ? root.tr("settings.previewBefore", [root.previewMinutes]) : ""
        shows: root.leadMinutes > 0
          ? root.tr("bar.soon", [root.tr("settings.previewTitle"), root.tr("unit.min", [root.previewMinutes])])
          : root.tr("settings.previewClockOnly")
        showsColor: root.leadMinutes > 0 ? Commons.Color.accent : root.faint
      }

      // How long "Now" lasts goes in the left column: the right one is
      // only ever what the bar itself shows.
      PreviewLine {
        visible: root.leadMinutes > 0
        when: root.tr(root.duringEvent === "firstMinutes" ? "settings.previewFirstMinutes" : "settings.previewDuring")
        shows: root.tr("bar.live", [root.tr("settings.previewTitle")])
        showsColor: Commons.Color.urgent
      }

      PreviewLine {
        visible: root.leadMinutes > 0 && root.duringEvent === "firstMinutes"
        when: root.tr("settings.previewAfter")
        shows: root.tr("settings.previewClockOnly")
        showsColor: root.faint
      }
    }
  }

  Gap {}

  ChoiceGroup {
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.barLabel")
    hint: root.tr("settings.barLabelHint")
    options: [0, 5, 15, 30, 60].map(function(minutes) {
      return { value: String(minutes), label: minutes === 0 ? root.tr("settings.never") : root.tr("settings.minutes", [minutes]) }
    })
    value: String(root.leadMinutes)
    onChosen: function(value) { root.pick("announceLeadMinutes", Number(value)) }
  }

  Gap {}

  ChoiceGroup {
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.duringEvent")
    hint: root.tr("settings.duringEventHint")
    options: [
      { value: "untilEnd", label: root.tr("settings.untilEnd") },
      { value: "firstMinutes", label: root.tr("settings.firstMinutes") }
    ]
    value: root.duringEvent
    onChosen: function(value) { root.pick("duringEvent", value) }
  }

  Gap { visible: nextChoice.visible }

  // Only "until it ends" leaves an event on screen when the next one is due.
  ChoiceGroup {
    id: nextChoice
    visible: root.duringEvent !== "firstMinutes"
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.nextDuringEvent")
    hint: root.tr("settings.nextDuringEventHint")
    options: [
      { value: "announce", label: root.tr("settings.announceNext") },
      { value: "keep", label: root.tr("settings.keepCurrent") }
    ]
    value: root.nextDuringEvent
    onChosen: function(value) { root.pick("nextDuringEvent", value) }
  }

  Gap {}

  ToggleRow {
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.reminders")
    hint: root.tr("settings.remindersHint")
    checked: root.reminders
    onActivated: root.pick("reminders", !root.reminders)
  }

  ToggleRow {
    visible: root.reminders
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.reminderDetails")
    hint: root.tr("settings.reminderDetailsHint")
    checked: root.reminderDetails
    onActivated: root.pick("reminderDetails", !root.reminderDetails)
  }
}
