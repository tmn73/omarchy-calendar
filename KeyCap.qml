import QtQuick
import qs.Commons

// A key of the keyboard, drawn small: its label on a faint rounded square,
// never narrower than it is tall, so "n" and "?" come out the same size.
Rectangle {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string text: ""
  property bool highlighted: false

  implicitWidth: Math.max(implicitHeight, label.implicitWidth + Style.space(5) * 2)
  implicitHeight: label.implicitHeight + Style.space(1) * 2
  width: implicitWidth
  height: implicitHeight
  radius: Style.cornerRadius
  color: Util.alpha(root.foreground, root.highlighted ? 0.20 : 0.10)

  Text {
    id: label
    anchors.centerIn: parent
    textFormat: Text.PlainText
    text: root.text
    color: Util.alpha(root.foreground, root.highlighted ? 0.95 : 0.75)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }
}
