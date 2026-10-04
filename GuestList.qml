import QtQuick
import qs.Commons
import qs.Ui

import "Model.js" as Model
import "Strings.js" as Strings

// The guests of an event: an email field (Enter adds), then one row per
// guest with the answer and a remove button. It never talks to Google; it
// hands the new list to the form.
Column {
  id: root

  property var guests: []
  // People from your events, most frequent first (the sync's guestSuggestions).
  property var suggestions: []
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"

  signal edited(var guests)
  // The form owns Escape, so the field passes it up.
  signal escaped()

  // What is typed and not added yet, so a save can still take it.
  readonly property string pendingText: guestField.text

  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)
  readonly property color hoverFill: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.08)
  readonly property var matches: guestField.activeFocus
    ? Model.matchGuests(root.suggestions, guestField.text, root.guests, 5)
    : []
  // The match Enter adds; -1 means the typed text.
  property int highlighted: -1

  spacing: Style.space(4)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function clearPending() {
    guestField.text = ""
    root.highlighted = -1
  }

  function addGuest(text) {
    var next = Model.addGuest(root.guests, text)
    // The same array back means the address was invalid or already in.
    if (next === root.guests) return
    root.edited(next)
    root.clearPending()
  }

  function answerLabel(status) {
    if (status === "accepted") return root.tr("guests.going")
    if (status === "tentative") return root.tr("guests.maybe")
    if (status === "declined") return root.tr("guests.declined")
    return root.tr("guests.awaiting")
  }

  function remove(index) {
    var next = root.guests.slice()
    next.splice(index, 1)
    root.edited(next)
  }

  TextField {
    id: guestField
    width: parent.width
    placeholderText: root.tr("guests.placeholder")
    foreground: root.foreground
    font.family: root.fontFamily
    inputMethodHints: Qt.ImhEmailCharactersOnly
    onTextEdited: root.highlighted = root.matches.length > 0 ? 0 : -1

    Keys.onPressed: function(event) {
      if (event.key === Qt.Key_Escape) {
        root.escaped()
        event.accepted = true
      } else if (event.key === Qt.Key_Down && root.matches.length > 0) {
        root.highlighted = Math.min(root.highlighted + 1, root.matches.length - 1)
        event.accepted = true
      } else if (event.key === Qt.Key_Up && root.matches.length > 0) {
        root.highlighted = Math.max(root.highlighted - 1, -1)
        event.accepted = true
      } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
        var chosen = root.highlighted >= 0 && root.highlighted < root.matches.length
          ? root.matches[root.highlighted].email
          : guestField.text
        root.addGuest(chosen)
        event.accepted = true
      }
    }
  }

  // The suggestions, under the field while it has focus and text.
  Repeater {
    model: root.matches

    Rectangle {
      required property var modelData
      required property int index

      width: root.width
      height: suggestionText.implicitHeight + Style.space(6)
      radius: Style.cornerRadius
      color: index === root.highlighted || suggestionHover.hovered ? root.hoverFill : "transparent"

      Text {
        id: suggestionText
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: Style.space(8)
        anchors.verticalCenter: parent.verticalCenter
        // Names come from other people's invitations: never rich text.
        textFormat: Text.PlainText
        text: modelData.name ? modelData.name + "  <" + modelData.email + ">" : modelData.email
        elide: Text.ElideRight
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      HoverHandler { id: suggestionHover; cursorShape: Qt.PointingHandCursor }
      TapHandler { onTapped: root.addGuest(modelData.email) }
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
        text: modelData.email + (modelData.organizer ? "  " + root.tr("guests.organizer") : "")
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
        tooltipText: root.tr("guests.remove")
        foreground: root.foreground
        fontFamily: root.fontFamily
        onClicked: root.remove(index)
      }
    }
  }
}
