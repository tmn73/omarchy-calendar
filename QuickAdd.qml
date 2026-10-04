import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// "call with Ana tomorrow 2pm for 45m", read as you type. The panel parses
// the text and hands back a preview line; Enter creates, Ctrl+Enter (or
// "More options") opens the full form with the parsed fields filled in.
Rectangle {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property string previewTitle: ""
  property string previewWhen: ""
  property alias text: field.text
  readonly property bool hasPreview: previewTitle !== ""

  signal submitted(bool moreOptions)
  signal escaped()

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function focusField() {
    field.forceActiveFocus()
  }

  function clear() {
    field.text = ""
  }

  implicitHeight: content.implicitHeight + Style.space(4) * 2
  radius: Style.cornerRadius
  color: Style.controlFill(field.activeFocus, false, root.foreground, Color.accent)
  border.width: Style.spacing.hairline
  border.color: field.activeFocus || field.text !== ""
    ? Color.accent
    : Style.normalBorderFor(root.foreground, Color.accent)

  Column {
    id: content
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.margins: Style.space(4)
    anchors.leftMargin: Style.space(10)

    Item {
      width: parent.width
      height: Math.max(field.implicitHeight, Style.spacing.controlHeight)

      Text {
        id: plus
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        text: "󰐕"
        color: Color.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.icon
      }

      // The kit's field with its own chrome turned off: the frame around
      // the field and its preview line is the one box.
      TextField {
        id: field
        anchors.left: plus.right
        anchors.right: keyHint.left
        anchors.leftMargin: Style.space(4)
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        placeholderText: root.tr("quick.placeholder")
        foreground: root.foreground
        font.family: root.fontFamily
        background: null
        Accessible.name: root.tr("quick.label")

        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            root.submitted((event.modifiers & Qt.ControlModifier) !== 0)
            event.accepted = true
          } else if (event.key === Qt.Key_Escape) {
            // The first Escape clears, the second hands the keys back.
            if (field.text !== "") field.text = ""
            else root.escaped()
            event.accepted = true
          }
        }
      }

      Rectangle {
        id: keyHint
        visible: !field.activeFocus
        anchors.right: parent.right
        anchors.rightMargin: Style.space(4)
        anchors.verticalCenter: parent.verticalCenter
        width: visible ? hintLabel.implicitWidth + Style.space(5) * 2 : 0
        height: hintLabel.implicitHeight + Style.space(1) * 2
        radius: Style.cornerRadius
        color: Util.alpha(root.foreground, 0.10)

        Text {
          id: hintLabel
          anchors.centerIn: parent
          text: "n"
          color: Util.alpha(root.foreground, 0.6)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }

    Item {
      visible: root.hasPreview
      width: parent.width
      height: visible ? Math.max(previewText.implicitHeight, createButton.height) + Style.space(8) * 2 : 0

      Rectangle {
        width: parent.width
        height: Style.spacing.hairline
        color: Util.alpha(root.foreground, 0.1)
      }

      Column {
        id: previewText
        anchors.left: parent.left
        anchors.right: moreButton.left
        anchors.rightMargin: Style.space(8)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(2)

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: root.previewTitle
          elide: Text.ElideRight
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          font.bold: true
        }

        Text {
          width: parent.width
          textFormat: Text.PlainText
          text: root.previewWhen
          wrapMode: Text.Wrap
          color: Util.alpha(root.foreground, 0.6)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      Button {
        id: moreButton
        anchors.right: createButton.left
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        text: root.tr("quick.moreOptions")
        bordered: true
        foreground: root.foreground
        fontFamily: root.fontFamily
        fontSize: Style.font.bodySmall
        verticalPadding: Style.space(4)
        onClicked: root.submitted(true)
      }

      AccentButton {
        id: createButton
        anchors.right: parent.right
        anchors.rightMargin: Style.space(4)
        anchors.verticalCenter: parent.verticalCenter
        text: root.tr("quick.create") + " ⏎"
        foreground: root.foreground
        fontFamily: root.fontFamily
        onClicked: root.submitted(false)
      }
    }
  }
}
