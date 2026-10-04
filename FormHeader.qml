import QtQuick
import qs.Commons

import "Strings.js" as Strings

// The event form's title, its Cancel and Save, and the last error under
// them. The panel pins it above the fields, so Save stays in view however
// far the form scrolls, and no field can change height and move it away
// from the pointer between a press and its release.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property bool isEditing: false
  property bool busy: false
  property string errorText: ""

  signal saveRequested()
  signal cancelRequested()

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  spacing: Style.space(6)

  Item {
    width: parent.width
    height: Math.max(formTitle.implicitHeight, saveButton.height)

    Text {
      id: formTitle
      anchors.left: parent.left
      anchors.right: formActions.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      text: root.tr(root.isEditing ? "form.editEvent" : "form.newEvent")
      elide: Text.ElideRight
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.50)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.letterSpacing: 1
      font.bold: true
      font.capitalization: Font.AllUppercase
    }

    Row {
      id: formActions
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(6)

      SecondaryButton {
        text: root.tr("common.cancel")
        foreground: root.foreground
        fontFamily: root.fontFamily
        enabled: !root.busy
        onClicked: root.cancelRequested()
      }

      AccentButton {
        id: saveButton
        text: root.busy
          ? root.tr("form.saving")
          : root.tr(root.isEditing ? "form.save" : "form.create")
        foreground: root.foreground
        fontFamily: root.fontFamily
        enabled: !root.busy
        onClicked: root.saveRequested()
      }
    }
  }

  // Can quote gws stderr, so never rich text.
  Text {
    width: parent.width
    visible: root.errorText !== ""
    text: root.errorText
    textFormat: Text.PlainText
    color: Color.urgent
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }
}
