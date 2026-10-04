import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// The upstream clock's year bar, opt-in, and under it the memento mori:
// double-tapping the year bar asks for a birth year and a life expectancy,
// and a second bar tracks one against the other. A birth year rather than
// an age, so it keeps counting on its own; double-tapping the life bar puts
// it away again. The panel owns the numbers and persists them.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property bool showYear: false
  property int year: 0
  property real yearDone: 0
  property int yearDonePercent: 0
  property int birthYear: 0
  property int lifeExpectancy: 0
  property real lifeDone: 0
  property int lifeDonePercent: 0

  property bool editing: false

  signal lifeCommitted(string born, string span)
  signal lifeCleared()
  signal editingFinished()

  visible: showYear || editing
  spacing: Style.space(6)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function startEditing() {
    root.editing = true
    Qt.callLater(function() {
      bornField.text = root.birthYear > 0 ? String(root.birthYear) : ""
      expectancyField.text = String(root.lifeExpectancy)
      bornField.selectAll()
      bornField.forceActiveFocus()
    })
  }

  function cancelEditing() {
    if (!root.editing) return
    root.editing = false
    root.editingFinished()
  }

  // Shared by both fields: Tab hops to the other one, Enter commits the
  // pair, Escape drops the lot.
  function handleKey(event, other) {
    if (event.key === Qt.Key_Escape) {
      root.cancelEditing()
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.lifeCommitted(bornField.text, expectancyField.text)
      root.cancelEditing()
      event.accepted = true
    } else if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
      other.selectAll()
      other.forceActiveFocus()
      event.accepted = true
    }
  }

  component Rail: Item {
    id: rail
    property string label: ""
    property real done: 0
    property int percent: 0

    width: root.width
    height: Math.max(railLabel.implicitHeight, Style.space(10))

    Text {
      id: railLabel
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      text: rail.label
      color: Util.alpha(root.foreground, 0.68)
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      font.letterSpacing: 1
    }

    Text {
      id: railPercent
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: rail.percent + "%"
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Rectangle {
      anchors.left: railLabel.right
      anchors.right: railPercent.left
      anchors.leftMargin: Style.space(12)
      anchors.rightMargin: Style.space(12)
      anchors.verticalCenter: parent.verticalCenter
      height: Style.space(6)
      radius: Style.cornerRadius > 0 ? height / 2 : 0
      color: Util.alpha(root.foreground, 0.12)

      Rectangle {
        width: Math.round(parent.width * rail.done)
        height: parent.height
        radius: parent.radius
        color: Style.selectedStateColor(root.foreground, Color.accent)

        Behavior on width { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
      }
    }
  }

  Rail {
    visible: root.showYear && !root.editing
    label: String(root.year)
    done: root.yearDone
    percent: root.yearDonePercent

    TapHandler {
      onDoubleTapped: root.startEditing()
    }
  }

  Row {
    visible: root.editing
    anchors.horizontalCenter: parent.horizontalCenter
    spacing: Style.space(10)

    Text {
      anchors.verticalCenter: parent.verticalCenter
      text: root.tr("life.born").toUpperCase()
      color: Util.alpha(root.foreground, 0.68)
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      font.letterSpacing: 1
    }

    TextField {
      id: bornField
      width: Style.space(70)
      anchors.verticalCenter: parent.verticalCenter
      placeholderText: root.tr("life.yearPlaceholder")
      foreground: root.foreground
      font.family: root.fontFamily
      inputMethodHints: Qt.ImhDigitsOnly
      Keys.onPressed: function(event) { root.handleKey(event, expectancyField) }
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      leftPadding: Style.space(6)
      text: root.tr("life.liveTo").toUpperCase()
      color: Util.alpha(root.foreground, 0.68)
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      font.letterSpacing: 1
    }

    TextField {
      id: expectancyField
      width: Style.space(60)
      anchors.verticalCenter: parent.verticalCenter
      placeholderText: "90"
      foreground: root.foreground
      font.family: root.fontFamily
      inputMethodHints: Qt.ImhDigitsOnly
      Keys.onPressed: function(event) { root.handleKey(event, bornField) }
    }
  }

  Rail {
    id: lifeRail
    visible: root.showYear && root.birthYear > 0
    label: root.tr("life.title").toUpperCase()
    done: root.lifeDone
    percent: root.lifeDonePercent

    TapHandler {
      onDoubleTapped: root.lifeCleared()
    }

    MouseArea {
      id: lifeMouse
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.NoButton

      PanelToolTip {
        visible: lifeMouse.containsMouse
        text: root.tr("life.mementoMori")
        fontFamily: root.fontFamily
      }
    }
  }
}
