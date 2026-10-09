import QtQuick
import qs.Commons
import qs.Commons as Commons

import "Strings.js" as Strings

// The Bar section of Settings: what the bar shows before and during an
// event, and the desktop reminders. A preview on top puts the choices in
// words. It reads the values and emits the settings to store.
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

  // The settings to store, for example { duringEvent: "firstMinutes" }.
  signal picked(var values)

  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)
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

  spacing: Style.space(8)

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
}
