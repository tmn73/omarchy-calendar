import QtQuick
import qs.Commons
import qs.Commons as Commons

import "Strings.js" as Strings

// The General section of Settings: the language, the first day of the week,
// and the state of the Google account: whether the panel may write, and
// whether the sync runs.
Column {
  id: root

  property color foreground: Commons.Color.foreground
  property string fontFamily: Style.font.family
  // The resolved display language ("en" | "pt").
  property string language: "en"
  // The stored setting ("auto" | "en" | "pt"), not the resolved language.
  property string languageSetting: "auto"
  property bool weekStartsMonday: true

  // True when the events file lists a calendar the panel may write to.
  property bool canWrite: false
  property bool writeSetupCopied: false
  property string syncState: "missing"
  property string setupCommand: ""
  property bool setupCommandCopied: false
  property int eventCount: 0
  property string sourceLabel: ""
  property string syncedAt: ""

  signal languagePicked(string value)
  signal weekStartToggled()
  signal writeSetupCopyRequested()
  signal setupCommandCopyRequested()

  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.50)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  spacing: Style.space(8)

  ChoiceGroup {
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.language")
    hint: root.tr("settings.languageHint")
    options: Strings.languageOptions(root.language)
    value: root.languageSetting
    onChosen: function(value) { root.languagePicked(value) }
  }

  Item { width: 1; height: Style.space(8) }

  ToggleRow {
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.weekMonday")
    hint: root.tr("settings.weekMondayHint")
    checked: root.weekStartsMonday
    onActivated: root.weekStartToggled()
  }

  Item { width: 1; height: Style.space(8) }

  SettingsCaption {
    foreground: root.foreground
    fontFamily: root.fontFamily
    text: root.tr("settings.googleAccount")
  }

  // The panel cannot turn writing on by itself: it needs a Google sign-in
  // in a terminal. So the row shows the state and hands over the command.
  ToggleRow {
    foreground: root.foreground
    fontFamily: root.fontFamily
    label: root.tr("settings.write")
    hint: root.tr(root.canWrite
      ? "settings.writeOn"
      : root.writeSetupCopied ? "settings.writeCopied" : "settings.writeOff")
    checked: root.canWrite
    onActivated: if (!root.canWrite) root.writeSetupCopyRequested()
  }

  // Read-only on purpose: changing the Google account is an OAuth browser
  // flow, which belongs to sync/setup and not to a popup in a status bar.
  // What belongs here is knowing whether it is working.
  Column {
    width: parent.width
    leftPadding: Style.space(4)
    spacing: Style.space(1)

    Text {
      text: root.tr("settings.sync")
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }

    Text {
      readonly property bool missing: root.syncState === "missing"

      width: parent.width - parent.leftPadding
      // Concatenates sourceLabel, which is whatever wrote the events file.
      textFormat: Text.PlainText
      wrapMode: Text.WordWrap
      color: missing && syncHover.hovered ? root.foreground : root.faint
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      text: {
        if (missing)
          return root.tr(root.setupCommandCopied ? "sync.copied" : "settings.syncMissing", [root.setupCommand])
        if (root.syncState === "version") return root.tr("settings.syncVersion")

        var lines = [Strings.trn(root.language, "settings.syncEvents", root.eventCount, [root.eventCount, root.sourceLabel])]
        lines.push(root.syncState === "stale"
          ? root.tr("settings.syncStale")
          : root.tr("settings.syncLast", [root.syncedAt]))
        return lines.join("\n")
      }

      HoverHandler {
        id: syncHover
        enabled: parent.missing
        cursorShape: Qt.PointingHandCursor
      }

      TapHandler {
        enabled: parent.missing
        onTapped: root.setupCommandCopyRequested()
      }
    }
  }
}
