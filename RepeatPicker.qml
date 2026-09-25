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

  signal chosen(string value)

  showLabel: false
  options: {
    var list = Model.repeatOptions(root.dateKey)
    if (root.hasCustom) list = list.concat([{ value: "custom", label: qsTr("Custom rule (kept as it is)") }])
    return list
  }

  onChanged: function(value) { root.chosen(value) }
}
