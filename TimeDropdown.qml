import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// A time menu in 15-minute steps, labelled in the user's eventTimeFormat.
// With fromMinutes set (the start time, for the end menu), it lists only the
// times after the start, with the duration, as Google does.
Dropdown {
  id: root

  // "HH:mm" or "h:mm AP", from the widget's eventTimeFormat setting.
  property string timeFormat: "HH:mm"
  // -1 for the start menu; the start in minutes for the end menu.
  property int fromMinutes: -1
  property string language: "en"

  readonly property var timeLocale: Qt.locale(Strings.localeName(root.language))

  signal chosen(string value)

  showLabel: false
  options: Model.timeOptions(root.fromMinutes, function(value) {
    var minutes = Model.minutesOf(value)
    return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(root.timeLocale, root.timeFormat)
  }, root.fromMinutes >= 0, root.language)

  onChanged: function(value) { root.chosen(value) }
}
