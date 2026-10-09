import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui

import "QuickAddParser.js" as QuickAddParser
import "Strings.js" as Strings

// "call with Ana tomorrow 2pm for 45m", read as you type. The panel parses
// the text and hands back a preview: one row per field with the words that
// set it, and those words marked in the field, so a word read as a date or
// a meeting never goes unseen. The "?" lists what it reads. Enter creates,
// Ctrl+Enter (or "More options") opens the full form with the parsed
// fields filled in.
Rectangle {
  id: root

  property color foreground: Commons.Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  // { rows, hint, opensForm } from QuickAddParser.quickAddPreview
  property var preview: ({ rows: [], hint: "", opensForm: false })
  property string calendarName: ""
  // [{ text, kind, start, end }] from QuickAddParser.quickAddUnderstood
  property var understood: []
  property alias text: field.text
  readonly property bool hasPreview: preview.rows.length > 0
  readonly property bool marksWords: understood.length > 0

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

  // "#rrggbb", the form StyledText takes.
  function hexOf(color) {
    return "#" + [color.r, color.g, color.b].map(function(channel) {
      return ("0" + Math.round(channel * 255).toString(16)).slice(-2)
    }).join("")
  }

  implicitHeight: content.implicitHeight + Style.space(4) * 2
  radius: Style.cornerRadius
  color: Style.controlFill(field.activeFocus, false, root.foreground, Commons.Color.accent)
  border.width: Style.spacing.hairline
  border.color: field.activeFocus || field.text !== ""
    ? Commons.Color.accent
    : Style.normalBorderFor(root.foreground, Commons.Color.accent)

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
        color: Commons.Color.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.icon
      }

      // The kit's field with its own chrome turned off: the frame around
      // the field and its preview line is the one box.
      TextField {
        id: field
        anchors.left: plus.right
        anchors.right: helpButton.left
        anchors.leftMargin: Style.space(4)
        anchors.rightMargin: Style.space(6)
        anchors.verticalCenter: parent.verticalCenter
        placeholderText: root.tr("quick.placeholder")
        foreground: root.foreground
        font.family: root.fontFamily
        background: null
        // With words to mark, the field's own text turns transparent and
        // the marked copy below draws it, so the two never show side by side.
        color: root.marksWords ? "transparent" : root.foreground
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

        // The text area, clipped like the field's own, so a long line
        // scrolls under the padding the same way.
        Item {
          visible: root.marksWords
          x: field.leftPadding
          y: field.topPadding
          width: field.width - field.leftPadding - field.rightPadding
          height: field.height - field.topPadding - field.bottomPadding
          clip: true

          Text {
            // Where the field draws its first character, inside the
            // padding: it moves as the field scrolls, which the cursor
            // rectangle reports.
            readonly property rect origin: {
              field.text
              field.cursorRectangle
              field.width
              return field.positionToRectangle(0)
            }
            x: origin.x
            y: origin.y
            textFormat: Text.StyledText
            text: QuickAddParser.markedText(field.text, root.understood, root.hexOf(Commons.Color.accent))
            color: root.foreground
            font: field.font
            renderType: field.renderType
          }
        }
      }

      // Drawn as a key, like the "n" beside it, so the two line up.
      KeyCap {
        id: helpButton
        anchors.right: keyHint.left
        anchors.rightMargin: Style.space(4)
        anchors.verticalCenter: parent.verticalCenter
        foreground: root.foreground
        fontFamily: root.fontFamily
        text: "?"
        highlighted: helpHover.hovered
        Accessible.name: root.tr("quick.helpLabel")

        HoverHandler {
          id: helpHover
          cursorShape: Qt.WhatsThisCursor
        }

        PanelToolTip {
          visible: helpHover.hovered
          text: root.tr("quick.help")
          fontFamily: root.fontFamily
        }
      }

      KeyCap {
        id: keyHint
        visible: !field.activeFocus
        anchors.right: parent.right
        anchors.rightMargin: Style.space(4)
        anchors.verticalCenter: parent.verticalCenter
        width: visible ? implicitWidth : 0
        foreground: root.foreground
        fontFamily: root.fontFamily
        text: "n"
      }
    }

    Item {
      visible: root.hasPreview
      width: parent.width
      height: visible ? previewColumn.implicitHeight + Style.space(8) * 2 : 0

      Rectangle {
        width: parent.width
        height: Style.spacing.hairline
        color: Util.alpha(root.foreground, 0.1)
      }

      Column {
        id: previewColumn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.rightMargin: Style.space(4)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(8)

        QuickAddSummary {
          width: parent.width
          foreground: root.foreground
          fontFamily: root.fontFamily
          language: root.language
          rows: root.preview.rows
          hint: root.preview.hint
        }

        Item {
          width: parent.width
          height: createButton.height

          Text {
            anchors.left: parent.left
            anchors.right: moreButton.left
            anchors.rightMargin: Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
            textFormat: Text.PlainText
            text: root.calendarName
            elide: Text.ElideRight
            color: Util.alpha(root.foreground, 0.6)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          SecondaryButton {
            id: moreButton
            anchors.right: createButton.left
            anchors.rightMargin: Style.space(6)
            anchors.verticalCenter: parent.verticalCenter
            text: root.tr("quick.moreOptions")
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.submitted(true)
          }

          AccentButton {
            id: createButton
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.tr(root.preview.opensForm ? "quick.checkGuest" : "quick.create") + " ⏎"
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.submitted(false)
          }
        }
      }
    }
  }
}
