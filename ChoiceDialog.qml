import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// A question with two answers and Cancel, for "Send invitation emails?" and
// "This event or all events?". Built like the shell's ConfirmDialog, which
// has one answer only.
Item {
  id: root

  property bool opened: false
  property string message: ""
  property string firstText: ""
  property string secondText: ""
  property string fontFamily: Style.font.family
  property string language: "en"

  signal first()
  signal second()
  signal canceled()

  visible: opened

  Rectangle {
    anchors.fill: parent
    color: Qt.rgba(Color.background.r, Color.background.g, Color.background.b, 0.7)
    MouseArea { anchors.fill: parent; onClicked: root.canceled() }
  }

  BorderSurface {
    anchors.centerIn: parent
    width: Math.min(parent.width - Style.space(40), Style.space(360))
    height: box.implicitHeight + Style.space(24)
    color: Color.popups.background
    borderSpec: Border.localOrSurfaceSpec("popups", "border", Color.popups.border,
                                          Color.popups.border, Style.normalBorderWidth)
    radius: Style.cornerRadius

    Column {
      id: box
      anchors.centerIn: parent
      width: parent.width - Style.space(24)
      spacing: Style.space(12)

      Text {
        width: parent.width
        // Can quote an event title, so never rich text.
        textFormat: Text.PlainText
        text: root.message
        wrapMode: Text.WordWrap
        color: Color.popups.text
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      // Right to left, so the first answer stays rightmost and the buttons
      // wrap instead of overflowing when translations run long.
      Flow {
        width: parent.width
        spacing: Style.space(8)
        layoutDirection: Qt.RightToLeft

        Button {
          text: root.firstText
          bordered: true
          fontFamily: root.fontFamily
          onClicked: root.first()
        }

        Button {
          text: root.secondText
          bordered: true
          fontFamily: root.fontFamily
          onClicked: root.second()
        }

        Button {
          text: Strings.tr(root.language, "common.cancel")
          fontFamily: root.fontFamily
          onClicked: root.canceled()
        }
      }
    }
  }
}
