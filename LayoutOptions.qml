import QtQuick
import qs.Commons

import "Model.js" as Model
import "Strings.js" as Strings

// What the panel shows: a preset, the details column mode, and one switch
// per block. The layout menu and Settings both host it. It reads the
// layout and emits the settings to store; the panel owns every value.
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

  spacing: Style.space(6)

  component Caption: Text {
    width: parent ? parent.width : 0
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  component Choices: Flow {
    id: choices

    property var options: []
    property string current: ""

    signal chosen(string value)

    width: parent ? parent.width : 0
    spacing: Style.space(3)

    Repeater {
      model: choices.options

      ChoicePill {
        required property var modelData
        foreground: root.foreground
        fontFamily: root.fontFamily
        label: root.tr(modelData.label)
        active: modelData.value === choices.current
        onActivated: choices.chosen(modelData.value)
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
    options: Model.LAYOUT_PRESET_NAMES.map(function(name) {
      return { value: name, label: "layout." + name }
    })
    current: root.presetName
    onChosen: function(value) { root.layoutPicked(Model.layoutPreset(value)) }
  }

  Caption {
    visible: root.presetName === ""
    text: root.tr("layout.custom")
  }

  Item { width: 1; height: Style.space(4) }

  Caption { text: root.tr("layout.details") }

  Choices {
    options: [
      { value: "click", label: "layout.detailsClick" },
      { value: "pinned", label: "layout.detailsPinned" },
      { value: "off", label: "layout.detailsOff" }
    ]
    current: root.layout.detailsColumn
    onChosen: function(value) { root.pick("detailsColumn", value) }
  }

  Caption {
    text: root.tr({
      click: "layout.detailsClickHint",
      pinned: "layout.detailsPinnedHint",
      off: "layout.detailsOffHint"
    }[root.layout.detailsColumn])
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
