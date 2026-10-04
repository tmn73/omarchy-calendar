import QtQuick
import qs.Commons
import qs.Ui

// One choice of several, with an optional label and hint above it: the
// kit's buttons, as in its ButtonGroup, but in a Flow so a long label wraps
// to the next line instead of running out of its column. Not Tab stops: the
// panel's own keys drive the days while it is open.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string label: ""
  property string hint: ""
  // [{ value, label }]
  property var options: []
  property string value: ""

  signal chosen(string value)

  width: parent ? parent.width : 0
  spacing: Style.space(6)

  Column {
    visible: root.label !== "" || root.hint !== ""
    width: parent.width
    spacing: Style.space(1)

    Text {
      visible: root.label !== ""
      width: parent.width
      text: root.label
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.WordWrap
    }

    Text {
      visible: root.hint !== ""
      width: parent.width
      text: root.hint
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.50)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      wrapMode: Text.WordWrap
    }
  }

  Flow {
    width: parent.width
    spacing: Style.spacing.md

    Repeater {
      model: root.options

      Button {
        required property var modelData
        text: modelData.label
        selected: modelData.value === root.value
        bordered: true
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        onClicked: root.chosen(modelData.value)
      }
    }
  }
}
