import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model

// The repeat menu: Google's presets, labelled from the start date. An event
// with a rule the presets cannot express keeps it, shown as "custom".
Dropdown {
  id: root

  property string dateKey: ""
  property bool hasCustom: false
  property string language: "en"

  signal chosen(string value)

  showLabel: false
  options: Model.repeatOptions(root.dateKey, root.language, root.hasCustom)

  onChanged: function(value) { root.chosen(value) }
}
