import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// The month: ISO week numbers down a gutter on the left, then the seven day
// columns, then the month stepper. Always six rows, so the panel is exactly
// as tall in February as in August. Today is outlined, the selected day
// washed, and each day carries a dot per calendar that has something on it.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property var weeks: []
  property var weekdayLabels: []
  property string selectedDayKey: ""
  property string monthLabel: ""
  property string weekStartTooltip: ""

  signal daySelected(string key)
  signal weekStartToggled()
  signal monthStepped(int delta)

  readonly property int cellWidth: Style.space(52)
  readonly property int cellHeight: Style.space(34)
  readonly property int cellSpacing: Style.space(2)
  readonly property int weekColumnWidth: Style.space(32)
  readonly property int gutterWidth: Style.space(14)

  spacing: Style.space(8)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  Item {
    width: gridColumn.width
    height: gridColumn.height

    WheelHandler {
      onWheel: function(event) {
        // Horizontal wheels and touchpad side-scrolls report y === 0;
        // without this every one of them would read as "next month".
        if (event.angleDelta.y === 0) return
        root.monthStepped(event.angleDelta.y > 0 ? -1 : 1)
      }
    }

    Column {
      id: gridColumn
      spacing: Style.space(3)

      Row {
        id: headerRow
        spacing: root.cellSpacing

        // The week-number heading doubles as the week-start toggle, the one
        // control here whose meaning is not self-evident, so its tooltip
        // names the day a click switches to.
        Rectangle {
          width: root.weekColumnWidth
          height: Style.space(16)
          radius: Style.cornerRadius
          color: weekStartMouse.containsMouse
            ? Style.hoverFillFor(root.foreground, Color.accent)
            : "transparent"

          Text {
            anchors.centerIn: parent
            text: root.tr("grid.week")
            color: weekStartMouse.containsMouse
              ? Style.hoverStateColor(root.foreground, Color.accent)
              : Util.alpha(root.foreground, 0.50)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.letterSpacing: 1
            font.bold: true
          }

          MouseArea {
            id: weekStartMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.weekStartToggled()
          }

          PanelToolTip {
            visible: weekStartMouse.containsMouse
            text: root.weekStartTooltip
            fontFamily: root.fontFamily
          }
        }

        Item {
          width: root.gutterWidth
          height: Style.space(16)
        }

        Repeater {
          model: root.weekdayLabels

          Text {
            required property var modelData
            width: root.cellWidth
            height: Style.space(16)
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            text: modelData
            color: Util.alpha(root.foreground, 0.68)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.letterSpacing: 1
            font.bold: true
          }
        }
      }

      Repeater {
        model: root.weeks

        Row {
          id: weekRow
          required property var modelData
          spacing: root.cellSpacing

          Text {
            width: root.weekColumnWidth
            height: root.cellHeight
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            text: weekRow.modelData.week
            color: Util.alpha(root.foreground, 0.50)
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Item {
            width: root.gutterWidth
            height: root.cellHeight
          }

          Repeater {
            model: weekRow.modelData.days

            Rectangle {
              id: dayCell
              required property var modelData
              readonly property bool selected: modelData.key === root.selectedDayKey

              width: root.cellWidth
              height: root.cellHeight
              radius: Style.cornerRadius
              // Today is outlined, not filled: a lit-up block shouts over a
              // grid this quiet. The selected day gets a faint wash instead,
              // so the two marks never compete.
              color: dayCell.selected
                ? Util.alpha(root.foreground, 0.10)
                : dayMouse.containsMouse ? Style.hoverFillFor(root.foreground, Color.accent) : "transparent"
              border.width: modelData.today ? Style.spacing.hairline : 0
              border.color: Style.normalBorderFor(root.foreground, Color.accent)

              Text {
                id: dayNumber
                anchors.centerIn: parent
                // Lifted just enough to clear the dots, and only on days
                // that have any, so an empty month does not shift.
                anchors.verticalCenterOffset: dayCell.modelData.hasEvent ? -Style.space(3) : 0
                text: dayCell.modelData.day
                color: dayCell.modelData.inMonth
                  ? (dayCell.modelData.weekend ? Util.alpha(root.foreground, 0.70) : root.foreground)
                  : Util.alpha(root.foreground, 0.40)
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: dayCell.modelData.today
              }

              Row {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.top: dayNumber.bottom
                anchors.topMargin: Style.space(1)
                spacing: Style.space(1)
                visible: dayCell.modelData.hasEvent

                Repeater {
                  model: dayCell.modelData.dots

                  Rectangle {
                    required property var modelData
                    width: Style.space(3)
                    height: width
                    radius: width / 2
                    color: modelData
                    opacity: dayCell.modelData.inMonth ? 0.9 : 0.4
                  }
                }
              }

              MouseArea {
                id: dayMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.daySelected(dayCell.modelData.key)
              }
            }
          }
        }
      }
    }

    // Hairline down the week-number gutter, beside the day rows only, so it
    // does not cut through the header band.
    Rectangle {
      x: root.weekColumnWidth + root.cellSpacing + Math.round((root.gutterWidth - width) / 2)
      y: headerRow.height + gridColumn.spacing
      width: Style.spacing.hairline
      height: gridColumn.height - headerRow.height - gridColumn.spacing
      color: root.foreground
      opacity: 0.1
    }
  }

  // The chevrons sit on the grid's outer edges so the row reads as a rail
  // spanning the grid it drives. The label is fixed-width, so they hold
  // still from "MAY" to "SEPTEMBER".
  Item {
    width: gridColumn.width
    height: monthLabel.implicitHeight + Style.space(10)

    Text {
      id: monthLabel
      anchors.centerIn: parent
      width: Style.space(170)
      horizontalAlignment: Text.AlignHCenter
      text: root.monthLabel.toUpperCase()
      color: Util.alpha(root.foreground, 0.72)
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
      font.letterSpacing: 1
    }

    PanelActionButton {
      // Pulled out by the button's own padding so the glyph, not its hit
      // box, lines up with the grid's edge.
      anchors.left: parent.left
      anchors.leftMargin: -Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      iconText: "󰅁"
      tooltipText: root.tr("nav.previousMonth")
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.monthStepped(-1)
    }

    PanelActionButton {
      anchors.right: parent.right
      anchors.rightMargin: -Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      iconText: "󰅂"
      tooltipText: root.tr("nav.nextMonth")
      foreground: root.foreground
      fontFamily: root.fontFamily
      onClicked: root.monthStepped(1)
    }
  }
}
