import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// One line of feedback over the bottom of the agenda: "Created: …",
// "Opened in Google Calendar", or an error. The panel owns the text and the
// timeout; this only draws it and offers a way to dismiss it early.
Rectangle {
  id: root

  property string text: ""
  property bool error: false
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"

  signal dismissed()

  visible: text !== ""
  implicitHeight: Math.max(label.implicitHeight, dismiss.height) + Style.space(8) * 2
  radius: Style.cornerRadius
  color: Color.popups.background
  border.width: Style.spacing.hairline
  border.color: root.error ? Color.urgent : Util.alpha(root.foreground, 0.25)

  // Raised over the list it covers: the popup background alone would read
  // as a gap in the agenda rather than a message on top of it.
  Rectangle {
    anchors.fill: parent
    radius: parent.radius
    color: Style.selectedFillFor(root.foreground, Color.accent)
  }

  Text {
    id: label
    anchors.left: parent.left
    anchors.right: dismiss.left
    anchors.leftMargin: Style.space(12)
    anchors.rightMargin: Style.space(6)
    anchors.verticalCenter: parent.verticalCenter
    // Can quote the event command's stderr, so never rich text.
    textFormat: Text.PlainText
    text: root.text
    wrapMode: Text.Wrap
    maximumLineCount: 3
    elide: Text.ElideRight
    color: root.error ? Color.urgent : root.foreground
    font.family: root.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  PanelActionButton {
    id: dismiss
    anchors.right: parent.right
    anchors.rightMargin: Style.space(6)
    anchors.verticalCenter: parent.verticalCenter
    iconText: "󰅖"
    tooltipText: Strings.tr(root.language, "toast.dismiss")
    foreground: root.foreground
    fontFamily: root.fontFamily
    onClicked: root.dismissed()
  }
}
