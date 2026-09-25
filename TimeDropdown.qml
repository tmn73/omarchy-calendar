import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model

// A time menu in 15-minute steps, labelled in the user's eventTimeFormat.
// With fromMinutes set (the start time, for the end menu), it lists only the
// times after the start, with the duration, as Google does.
Dropdown {
  id: root

  // "HH:mm" or "h:mm AP", from the widget's eventTimeFormat setting.
  property string timeFormat: "HH:mm"
  // -1 for the start menu; the start in minutes for the end menu.
  property int fromMinutes: -1

  signal chosen(string value)

  showLabel: false
  options: Model.timeOptions(root.fromMinutes, function(value) {
    var parts = value.split(":")
    return Qt.formatDateTime(new Date(2000, 0, 1, Number(parts[0]), Number(parts[1])), root.timeFormat)
  }, root.fromMinutes >= 0)

  onChanged: function(value) { root.chosen(value) }
}
