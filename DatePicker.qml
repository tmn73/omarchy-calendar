import QtQuick
import QtQuick.Controls as QQC
import qs.Commons
import qs.Ui

import "Model.js" as Model

// A date field: a button showing the day, and a small month grid under it.
// The grid comes from Model.monthGrid, the same one the panel's calendar
// uses, so both agree on week starts and on which days belong to a month.
Item {
  id: root

  property string dateKey: ""
  property int weekStart: 1
  property color foreground: Color.popups.text
  property string fontFamily: Style.font.family

  signal picked(string dateKey)

  // The month on show in the popup, which the arrows move without changing
  // the picked date.
  property int viewYear: 2000
  property int viewMonth: 0

  implicitWidth: trigger.implicitWidth
  implicitHeight: trigger.implicitHeight

  function keyParts(key) {
    var parts = String(key).split("-")
    return { year: Number(parts[0]), month: Number(parts[1]) - 1, day: Number(parts[2]) }
  }

  function openPicker() {
    var p = keyParts(root.dateKey)
    root.viewYear = p.year
    root.viewMonth = p.month
    popup.open()
  }

  function stepMonth(delta) {
    var d = new Date(root.viewYear, root.viewMonth + delta, 1)
    root.viewYear = d.getFullYear()
    root.viewMonth = d.getMonth()
  }

  Button {
    id: trigger
    width: parent.width
    text: {
      var p = root.keyParts(root.dateKey)
      return isNaN(p.year) ? "" : Qt.formatDate(new Date(p.year, p.month, p.day), "ddd d MMM yyyy")
    }
    bordered: true
    foreground: root.foreground
    fontFamily: root.fontFamily
    onClicked: popup.opened ? popup.close() : root.openPicker()
  }

  QQC.Popup {
    id: popup
    x: 0
    y: trigger.height + Style.spacing.xxs
    padding: Style.space(8)
    focus: true

    background: BorderSurface {
      color: Color.popups.background
      borderSpec: Border.localOrSurfaceSpec("popups", "border", Color.popups.border,
                                            Color.popups.border, Style.normalBorderWidth)
      radius: Style.cornerRadius
    }

    contentItem: Column {
      spacing: Style.space(4)

      Item {
        width: dayGrid.width
        height: monthLabel.implicitHeight

        Text {
          anchors.left: parent.left
          text: "‹"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          MouseArea { anchors.fill: parent; anchors.margins: -Style.space(4); onClicked: root.stepMonth(-1) }
        }

        Text {
          id: monthLabel
          anchors.horizontalCenter: parent.horizontalCenter
          text: Qt.formatDate(new Date(root.viewYear, root.viewMonth, 1), "MMMM yyyy")
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          font.bold: true
        }

        Text {
          anchors.right: parent.right
          text: "›"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          MouseArea { anchors.fill: parent; anchors.margins: -Style.space(4); onClicked: root.stepMonth(1) }
        }
      }

      Grid {
        id: dayGrid
        columns: 7
        spacing: Style.space(2)

        Repeater {
          model: {
            var weeks = Model.monthGrid(root.viewYear, root.viewMonth, root.weekStart,
                                        Model.keyForDate(new Date()), null)
            var days = []
            for (var w = 0; w < weeks.length; w++) days = days.concat(weeks[w].days)
            return days
          }

          Rectangle {
            required property var modelData
            readonly property bool chosen: modelData.key === root.dateKey

            width: Style.space(28)
            height: Style.space(24)
            radius: Style.cornerRadius
            color: chosen
              ? Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.25)
              : dayHover.hovered
                ? Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)
                : "transparent"
            border.width: modelData.today ? Style.spacing.hairline : 0
            border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.5)

            Text {
              anchors.centerIn: parent
              text: modelData.day
              color: modelData.inMonth
                ? root.foreground
                : Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.4)
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: parent.chosen
            }

            HoverHandler { id: dayHover; cursorShape: Qt.PointingHandCursor }

            TapHandler {
              onTapped: {
                root.dateKey = modelData.key
                root.picked(modelData.key)
                popup.close()
              }
            }
          }
        }
      }
    }
  }
}
