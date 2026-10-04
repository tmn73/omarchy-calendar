import QtQuick
import qs.Commons

// Shows that a Flickable holds more than it shows: a thin thumb on its
// right edge, and a fade over its bottom edge while there is more below.
// Lay it over the Flickable; it takes no clicks.
Item {
  id: root

  property Flickable flickable: null
  property color foreground: Color.foreground
  // What the fade turns into: the surface behind the Flickable.
  property color background: Color.popups.background

  readonly property bool scrollable: flickable !== null && flickable.contentHeight > flickable.height + 1
  readonly property bool moreBelow: scrollable
    && flickable.contentY + flickable.height < flickable.contentHeight - 1

  visible: scrollable

  Rectangle {
    visible: root.moreBelow
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    height: Style.space(36)
    gradient: Gradient {
      GradientStop { position: 0.0; color: Qt.rgba(root.background.r, root.background.g, root.background.b, 0) }
      GradientStop { position: 1.0; color: root.background }
    }
  }

  Rectangle {
    anchors.right: parent.right
    width: Style.space(3)
    radius: width / 2
    y: root.flickable ? root.flickable.visibleArea.yPosition * root.height : 0
    height: root.flickable ? Math.max(Style.space(24), root.flickable.visibleArea.heightRatio * root.height) : 0
    color: Util.alpha(root.foreground, 0.3)
  }
}
