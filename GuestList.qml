import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model

// The guests of an event: an email field (Enter adds), then one row per
// guest with the answer and a remove button. It never talks to Google; it
// hands the new list to the form.
Column {
  id: root

  property var guests: []
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family

  signal edited(var guests)
  // The form owns Escape, so the field passes it up.
  signal escaped()

  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  spacing: Style.space(4)

  function answerLabel(status) {
    if (status === "accepted") return qsTr("Going")
    if (status === "tentative") return qsTr("Maybe")
    if (status === "declined") return qsTr("Declined")
    return qsTr("Awaiting")
  }

  function remove(index) {
    var next = root.guests.slice()
    next.splice(index, 1)
    root.edited(next)
  }

  TextField {
    id: guestField
    width: parent.width
    placeholderText: qsTr("Add guests")
    foreground: root.foreground
    font.family: root.fontFamily
    inputMethodHints: Qt.ImhEmailCharactersOnly

    Keys.onPressed: function(event) {
      if (event.key === Qt.Key_Escape) {
        root.escaped()
        event.accepted = true
      } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
        var next = Model.addGuest(root.guests, guestField.text)
        // The same array back means the address was invalid or already in.
        if (next !== root.guests) {
          root.edited(next)
          guestField.text = ""
        }
        event.accepted = true
      }
    }
  }

  Repeater {
    model: root.guests

    Item {
      required property var modelData
      required property int index

      width: root.width
      height: Math.max(guestEmail.implicitHeight, removeButton.height)

      Text {
        id: guestEmail
        anchors.left: parent.left
        anchors.right: guestAnswer.left
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        // Typed by the user or sent by an organizer: never rich text.
        textFormat: Text.PlainText
        text: modelData.email + (modelData.organizer ? "  " + qsTr("(organizer)") : "")
        elide: Text.ElideRight
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Text {
        id: guestAnswer
        anchors.right: removeButton.left
        anchors.rightMargin: Style.space(4)
        anchors.verticalCenter: parent.verticalCenter
        text: root.answerLabel(modelData.responseStatus)
        color: root.faint
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }

      PanelActionButton {
        id: removeButton
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        iconText: "󰅖"
        tooltipText: qsTr("Remove")
        foreground: root.foreground
        fontFamily: root.fontFamily
        onClicked: root.remove(index)
      }
    }
  }
}
