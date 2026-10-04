import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// The Panel section of Settings: a preset, where the agenda sits, and one
// switch per block. It reads the layout and emits the settings to store;
// the panel owns every value.
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

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function pick(key, value) {
    var values = {}
    values[key] = value
    root.layoutPicked(values)
  }

  spacing: Style.space(8)

  component Caption: SettingsCaption {
    foreground: root.foreground
    fontFamily: root.fontFamily
  }

  component Gap: Item { width: 1; height: Style.space(8) }

  component BlockSwitch: ToggleRow {
    property string key: ""
    foreground: root.foreground
    fontFamily: root.fontFamily
    checked: root.layout[key] === true
    onActivated: root.pick(key, !checked)
  }

  Caption {
    text: root.tr("layout.preset")
    note: root.presetName === "" ? root.tr("layout.custom") : ""
    noteColor: Color.accent
  }

  ChoiceGroup {
    foreground: root.foreground
    fontFamily: root.fontFamily
    hint: root.tr("layout.presetHint")
    options: Model.LAYOUT_PRESET_NAMES.map(function(name) { return { value: name, label: root.tr("layout." + name) } })
    // Empty for a layout set by hand, so no preset reads as chosen.
    value: root.presetName
    onChosen: function(value) { root.layoutPicked(Model.layoutPreset(value)) }
  }

  Gap {}

  Caption { text: root.tr("layout.calendarSection") }
  BlockSwitch { key: "showYearProgress"; label: root.tr("settings.progress"); hint: root.tr("layout.progressHint") }
  BlockSwitch { key: "showShortcutLegend"; label: root.tr("layout.shortcutLegend"); hint: root.tr("layout.shortcutLegendHint") }

  Gap {}

  Caption { text: root.tr("agenda.title") }

  ChoiceGroup {
    foreground: root.foreground
    fontFamily: root.fontFamily
    options: [
      { value: "beside", label: root.tr("layout.agendaBeside") },
      { value: "below", label: root.tr("layout.agendaBelow") }
    ]
    value: root.layout.agendaPlacement
    onChosen: function(value) { root.pick("agendaPlacement", value) }
  }

  BlockSwitch { key: "showQuickAdd"; label: root.tr("quick.label"); hint: root.tr("layout.quickAddHint") }
  BlockSwitch { key: "showNextUp"; label: root.tr("layout.nextUp"); hint: root.tr("layout.nextUpHint") }
  BlockSwitch { key: "showUpcomingDays"; label: root.tr("agenda.upcoming"); hint: root.tr("layout.upcomingHint") }
}
