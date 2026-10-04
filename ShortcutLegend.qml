import QtQuick
import qs.Commons

import "Strings.js" as Strings

// The keyboard map, folded under its title: a panel summoned by hotkey is
// used from the keyboard, but once the keys are learnt the map is only in
// the way. One click shows it again.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property bool expanded: false

  signal expandToggled()

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
    { keys: "t", label: "keys.today" }
  ]

  spacing: Style.space(8)

  FoldHeader {
    foreground: root.foreground
    fontFamily: root.fontFamily
    text: Strings.tr(root.language, "keys.title")
    expanded: root.expanded
    onToggled: root.expandToggled()
  }

  Flow {
    visible: root.expanded
    width: parent.width
    spacing: Style.space(10)

    Repeater {
      model: root.shortcuts

      Row {
        id: shortcut
        required property var modelData
        spacing: Style.space(4)

        Rectangle {
          anchors.verticalCenter: parent.verticalCenter
          width: keyLabel.implicitWidth + Style.space(5) * 2
          height: keyLabel.implicitHeight + Style.space(1) * 2
          radius: Style.cornerRadius
          color: Util.alpha(root.foreground, 0.10)

          Text {
            id: keyLabel
            anchors.centerIn: parent
            text: shortcut.modelData.keys
            color: Util.alpha(root.foreground, 0.85)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        Text {
          anchors.verticalCenter: parent.verticalCenter
          text: Strings.tr(root.language, shortcut.modelData.label)
          color: Util.alpha(root.foreground, 0.55)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
