import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// Today, large, with "weekday · time · week N" under it and the settings
// button at the right. Once the view has moved away from today the date is
// also the way back: clicking what you are looking for beats hunting for a
// reset button.
Item {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  property string dateText: ""
  property string sublineText: ""
  property bool settingsOpen: false
  property bool canGoHome: false

  signal homeRequested()
  signal settingsToggled()

  // Decorative, so sized off the spacing scale rather than the font scale.
  readonly property int datePixelSize: Style.space(30)
  readonly property int iconPixelSize: Math.round(datePixelSize * 0.95)

  // A long month in a wide monospace font ("September 30") can run under
  // the settings button, so both glyphs shrink together until the row fits.
  readonly property real availableWidth: width - settingsButton.width - Style.space(8)
  readonly property real naturalWidth: iconMetrics.advanceWidth + dateMetrics.advanceWidth + heroRow.spacing
  readonly property real fit: naturalWidth > 0 ? Math.max(0.4, Math.min(1, availableWidth / naturalWidth)) : 1
  readonly property color heroColor: homeMouse.containsMouse
    ? Style.hoverStateColor(root.foreground, Color.accent)
    : root.foreground

  implicitHeight: Math.max(heroRow.height, settingsButton.height)

  TextMetrics {
    id: iconMetrics
    text: heroIcon.text
    font.family: root.fontFamily
    font.pixelSize: root.iconPixelSize
  }

  TextMetrics {
    id: dateMetrics
    text: root.dateText
    font.family: root.fontFamily
    font.pixelSize: root.datePixelSize
    font.bold: true
  }

  Row {
    id: heroRow
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    spacing: Style.space(14)

    Text {
      id: heroIcon
      anchors.verticalCenter: parent.verticalCenter
      text: "󰃭"
      color: root.heroColor
      font.family: root.fontFamily
      font.pixelSize: Math.floor(root.iconPixelSize * root.fit)
    }

    Column {
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(4)

      Text {
        textFormat: Text.PlainText
        text: root.dateText
        color: root.heroColor
        font.family: root.fontFamily
        font.pixelSize: Math.floor(root.datePixelSize * root.fit)
        font.bold: true
      }

      Text {
        textFormat: Text.PlainText
        text: root.sublineText
        color: Util.alpha(root.foreground, 0.68)
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }
    }
  }

  MouseArea {
    id: homeMouse
    x: heroRow.x
    y: heroRow.y
    width: heroRow.width
    height: heroRow.height
    enabled: root.canGoHome
    hoverEnabled: enabled
    cursorShape: Qt.PointingHandCursor
    onClicked: root.homeRequested()

    PanelToolTip {
      visible: homeMouse.containsMouse
      text: Strings.tr(root.language, "nav.backToToday")
      fontFamily: root.fontFamily
    }
  }

  PanelActionButton {
    id: settingsButton
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    iconText: root.settingsOpen ? "󰅖" : "󰒓"
    tooltipText: Strings.tr(root.language, root.settingsOpen ? "nav.backToCalendar" : "nav.settings")
    foreground: root.foreground
    fontFamily: root.fontFamily
    onClicked: root.settingsToggled()
  }
}
