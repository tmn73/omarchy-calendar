import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// The keyboard map behind a "?" beside the settings button. A panel
// summoned by hotkey is used from the keyboard, but once the keys are
// learnt the map is only in the way, so it takes no room until asked for:
// a click shows it, another click or moving away hides it.
PanelActionButton {
  id: root

  property string language: "en"
  property bool open: false

  readonly property var shortcuts: [
    { keys: "n", label: "keys.new" },
    { keys: "j k", label: "keys.navigate" },
    { keys: "⏎", label: "keys.details" },
    { keys: "e", label: "keys.edit" },
    { keys: "m", label: "keys.join" },
    { keys: "o", label: "keys.open" },
    { keys: "← →", label: "keys.days" },
    { keys: "↑ ↓", label: "keys.weeks" },
    { keys: "[ ]", label: "keys.month" },
    { keys: "{ }", label: "keys.year" },
    { keys: "t", label: "keys.today" },
    { keys: "Esc", label: "keys.back" }
  ]

  iconText: "?"
  Accessible.name: Strings.tr(root.language, "keys.title")

  onClicked: root.open = !root.open
  onHovered: function(isHovered) { if (!isHovered) root.open = false }

  PanelToolTip {
    visible: root.open
    delay: 0
    fontFamily: root.fontFamily
    text: Model.shortcutLegendText(
      Strings.tr(root.language, "keys.title"),
      root.shortcuts.map(function(s) { return { keys: s.keys, label: Strings.tr(root.language, s.label) } }))
  }
}
