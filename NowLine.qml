import QtQuick
import qs.Commons

// Where now falls among the day's timed rows: a dot, the time, and a rule
// across the rest. Drawn above the first row still to start, or after the
// last one once the day is all under way or done.
Item {
  id: root

  property string timeText: ""
  property string fontFamily: Style.font.family

  implicitHeight: label.implicitHeight + Style.space(4)

  Rectangle {
    id: dot
    anchors.left: parent.left
    anchors.leftMargin: Style.space(4)
    anchors.verticalCenter: parent.verticalCenter
    width: Style.space(6)
    height: width
    radius: width / 2
    color: Color.accent
  }

  Text {
    id: label
    anchors.left: dot.right
    anchors.leftMargin: Style.space(6)
    anchors.verticalCenter: parent.verticalCenter
    text: root.timeText
    color: Color.accent
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.bold: true
  }

  Rectangle {
    anchors.left: label.right
    anchors.right: parent.right
    anchors.leftMargin: Style.space(6)
    anchors.verticalCenter: parent.verticalCenter
    height: Math.max(1, Style.space(1.5))
    color: Color.accent
  }
}
