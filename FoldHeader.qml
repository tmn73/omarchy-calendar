import QtQuick
import qs.Commons

// A section title that folds what is under it: a triangle, the title and
// an optional summary on one line. A click unfolds the section; the owner
// keeps the state and flips it on toggled().
Rectangle {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string text: ""
  property bool expanded: false

  signal toggled()

  width: parent ? parent.width : 0
  height: label.implicitHeight + Style.space(4) * 2
  radius: Style.cornerRadius
  color: mouse.containsMouse ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"

  Text {
    id: label
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.leftMargin: Style.space(2)
    anchors.verticalCenter: parent.verticalCenter
    textFormat: Text.PlainText
    text: (root.expanded ? "▾ " : "▸ ") + root.text
    elide: Text.ElideRight
    color: Util.alpha(root.foreground, 0.6)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
    font.capitalization: Font.AllUppercase
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.toggled()
  }
}
