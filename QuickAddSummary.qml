import QtQuick
import qs.Commons

import "Strings.js" as Strings

// What quick add understood, one row per field: its name, the value it
// will create, and the words that set it, or "default" when none did. So
// "in 2 minutes" reads as a start, not as a length. A hint line follows
// when there is something to say.
Column {
  id: root

  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property string language: "en"
  // [{ key, value, sources, assumed }] from QuickAddParser.quickAddPreview
  property var rows: []
  // A Strings key, or "".
  property string hint: ""

  readonly property color muted: Util.alpha(foreground, 0.6)
  // The names share one column, as wide as the widest one shown.
  readonly property real nameWidth: {
    var widest = 0
    for (var i = 0; i < rows.length; i++) {
      var name = root.nameOf(rows[i].key)
      widest = Math.max(widest, nameMetrics.advanceWidth(name) + name.length * nameMetrics.font.letterSpacing)
    }
    return Math.ceil(widest)
  }

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function nameOf(key) {
    return root.tr("quick.row." + key).toUpperCase()
  }

  function wordsOf(row) {
    if (row.assumed) return root.tr("quick.assumed")
    return row.sources.map(function(words) { return "“" + words + "”" }).join(" ")
  }

  spacing: Style.space(3)

  FontMetrics {
    id: nameMetrics
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
  }

  Repeater {
    model: root.rows

    Item {
      id: line

      required property var modelData
      readonly property bool isTitle: modelData.key === "title"

      width: root.width
      height: Math.max(nameText.implicitHeight, valueText.implicitHeight, wordsText.implicitHeight)

      Text {
        id: nameText
        anchors.left: parent.left
        anchors.baseline: valueText.baseline
        width: root.nameWidth
        text: root.nameOf(line.modelData.key)
        color: root.muted
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.letterSpacing: 1
      }

      Text {
        id: valueText
        anchors.left: nameText.right
        anchors.leftMargin: Style.space(6)
        anchors.right: wordsText.left
        anchors.rightMargin: wordsText.text !== "" ? Style.space(6) : 0
        anchors.verticalCenter: parent.verticalCenter
        textFormat: Text.PlainText
        text: line.modelData.value
        elide: Text.ElideRight
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: line.isTitle ? Style.font.body : Style.font.bodySmall
        font.bold: line.isTitle
      }

      // The typed words in the accent, as the field marks them; a default
      // in grey.
      Text {
        id: wordsText
        anchors.right: parent.right
        anchors.baseline: valueText.baseline
        width: Math.min(implicitWidth, root.width * 0.4)
        textFormat: Text.PlainText
        text: root.wordsOf(line.modelData)
        elide: Text.ElideRight
        horizontalAlignment: Text.AlignRight
        color: line.modelData.assumed ? root.muted : Color.accent
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.italic: line.modelData.assumed
      }
    }
  }

  Text {
    visible: root.hint !== ""
    width: root.width
    topPadding: Style.space(2)
    textFormat: Text.PlainText
    text: root.hint !== "" ? root.tr(root.hint) : ""
    wrapMode: Text.Wrap
    color: root.muted
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }
}
