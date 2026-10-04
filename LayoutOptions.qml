import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// What the panel shows: a preset, where the agenda sits, the details column
// mode, and one switch per block. The layout menu and Settings both host
// it. It reads the layout and emits the settings to store; the panel owns
// every value.
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

  // The kit's one-of-N row, at the panel's text size. Not a Tab stop: the
  // panel's own keys drive the days while the menu is open.
  component Choices: ButtonGroup {
    foreground: root.foreground
    fontFamily: root.fontFamily
    fontSize: Style.font.bodySmall
    focusable: false
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
    onChanged: function(value) { root.layoutPicked(Model.layoutPreset(value)) }
  }

  Caption {
    visible: root.presetName === ""
    text: root.tr("layout.custom")
  }

  Item { width: 1; height: Style.space(4) }

  Caption { text: root.tr("layout.agendaPlacement") }

  Choices {
    options: root.options([["beside", "layout.agendaBeside"], ["below", "layout.agendaBelow"]])
    value: root.layout.agendaPlacement
    onChanged: function(value) { root.pick("agendaPlacement", value) }
  }

  Item { width: 1; height: Style.space(4) }

  Caption { text: root.tr("layout.details") }

  Choices {
    options: root.options([["click", "layout.detailsClick"], ["pinned", "layout.detailsPinned"]])
    value: root.layout.detailsColumn
    onChanged: function(value) { root.pick("detailsColumn", value) }
  }

  Caption {
    text: root.tr(root.layout.detailsColumn === "pinned" ? "layout.detailsPinnedHint" : "layout.detailsClickHint")
  }

  Item { width: 1; height: Style.space(4) }

  Caption { text: root.tr("layout.leftColumn") }
  BlockSwitch { key: "showYearProgress"; label: root.tr("settings.progress") }
  BlockSwitch { key: "showCalendarList"; label: root.tr("layout.calendarList") }
  BlockSwitch { key: "showShortcutLegend"; label: root.tr("layout.shortcutLegend") }

  Item { width: 1; height: Style.space(4) }

  Caption { text: root.tr("agenda.title") }
  BlockSwitch { key: "showQuickAdd"; label: root.tr("quick.label") }
  BlockSwitch { key: "showNextUp"; label: root.tr("layout.nextUp") }
  BlockSwitch { key: "showUpcomingDays"; label: root.tr("agenda.upcoming") }
}
