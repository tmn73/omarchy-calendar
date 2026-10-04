import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// What the panel shows: a preset, where the agenda sits, and one switch per
// block. The layout menu and Settings both host it. It reads the layout and
// emits the settings to store; the panel owns every value.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  // Model.layoutFromSettings
  property var layout: Model.layoutPreset("standard")

  // The settings to store, for example { showQuickAdd: false }.
  signal layoutPicked(var values)

  readonly property string presetName: Model.layoutPresetName(layout)
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function pick(key, value) {
    var values = {}
    values[key] = value
    root.layoutPicked(values)
  }

  function options(pairs) {
    return pairs.map(function(pair) { return { value: pair[0], label: root.tr(pair[1]) } })
  }

  spacing: Style.space(6)

  component Caption: Text {
    width: parent ? parent.width : 0
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  // One of several: the kit's buttons, as in its ButtonGroup, but in a Flow
  // so a long label wraps to the next line instead of running out of the
  // menu. Not Tab stops: the panel's own keys drive the days meanwhile.
  component Choices: Flow {
    id: choices

    property var options: []
    property string value: ""

    signal chosen(string value)

    width: parent ? parent.width : 0
    spacing: Style.spacing.md

    Repeater {
      model: choices.options

      Button {
        required property var modelData
        text: modelData.label
        selected: modelData.value === choices.value
        bordered: true
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: choices.chosen(modelData.value)
      }
    }
  }

  component BlockSwitch: ToggleRow {
    property string key: ""
    foreground: root.foreground
    fontFamily: root.fontFamily
    checked: root.layout[key] === true
    onActivated: root.pick(key, !checked)
  }

  Choices {
    options: root.options(Model.LAYOUT_PRESET_NAMES.map(function(name) { return [name, "layout." + name] }))
    // Empty for a layout set by hand, so no preset reads as chosen.
    value: root.presetName
    onChosen: function(value) { root.layoutPicked(Model.layoutPreset(value)) }
  }

  Caption {
    visible: root.presetName === ""
    text: root.tr("layout.custom")
  }

  Item { width: 1; height: Style.space(4) }

  Caption { text: root.tr("layout.calendarSection") }
  BlockSwitch { key: "showYearProgress"; label: root.tr("settings.progress") }
  BlockSwitch { key: "showShortcutLegend"; label: root.tr("layout.shortcutLegend") }

  Item { width: 1; height: Style.space(4) }

  Caption { text: root.tr("agenda.title") }

  Choices {
    options: root.options([["beside", "layout.agendaBeside"], ["below", "layout.agendaBelow"]])
    value: root.layout.agendaPlacement
    onChosen: function(value) { root.pick("agendaPlacement", value) }
  }

  BlockSwitch { key: "showQuickAdd"; label: root.tr("quick.label") }
  BlockSwitch { key: "showNextUp"; label: root.tr("layout.nextUp") }
  BlockSwitch { key: "showUpcomingDays"; label: root.tr("agenda.upcoming") }
}
