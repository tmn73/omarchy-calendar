import QtQuick
import qs.Commons

// The title of a group of settings: small, bold, in capitals, with an
// optional note at the right (a count, "Custom").
Item {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string text: ""
  property string note: ""
  property color noteColor: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  width: parent ? parent.width : 0
  implicitHeight: title.implicitHeight

  Text {
    id: title
    anchors.left: parent.left
    anchors.right: noteText.left
    anchors.rightMargin: Style.space(8)
    text: root.text
    elide: Text.ElideRight
    color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.55)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
    font.capitalization: Font.AllUppercase
  }

  Text {
    id: noteText
    anchors.right: parent.right
    anchors.baseline: title.baseline
    text: root.note
    color: root.noteColor
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }
}
