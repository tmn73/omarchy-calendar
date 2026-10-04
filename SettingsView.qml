import QtQuick
import qs.Commons
import qs.Ui

import "Strings.js" as Strings

// The calendar's settings page. It reads state and emits intent; the panel
// owns every value and is the only writer of shell.json.
Column {
  id: root

  property color foreground: "white"
  property string fontFamily: ""
  // The resolved display language ("en" | "pt").
  property string language: "en"

  property var calendars: []
  property var hiddenCalendars: []
  property bool showYearProgress: false
  property bool weekStartsMonday: true
  property bool showWorkingLocation: false
  property bool hideDeclined: false
  property int announceLeadMinutes: 15
  // The stored setting ("auto" | "en" | "pt"), not the resolved language.
  property string languageSetting: "auto"

  property string syncedAt: ""
  property string sourceLabel: ""
  property int eventCount: 0
  property string syncState: "missing"
  property string setupCommand: ""
  property bool setupCommandCopied: false
  // True when the events file lists a calendar the panel may write to.
  property bool canWrite: false
  property bool writeSetupCopied: false

  signal calendarToggled(string calendarId)
  signal yearProgressToggled()
  signal weekStartToggled()
  signal workingLocationToggled()
  signal hideDeclinedToggled()
  signal leadMinutesPicked(int minutes)
  signal languagePicked(string value)
  signal setupCommandCopyRequested()
  signal writeSetupCopyRequested()

  // Same fade as Panel.quiet(): Qt.darker only reads as quieter on a dark
  // background, and on a light theme it raises contrast instead.
  function quiet(amount) {
    return Qt.rgba(foreground.r, foreground.g, foreground.b, amount)
  }

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  readonly property color muted: quiet(0.68)
  readonly property color faint: quiet(0.50)

  spacing: Style.space(10)

  component SectionTitle: Text {
    width: parent ? parent.width : 0
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
    font.capitalization: Font.AllUppercase
  }

  component Note: Text {
    width: parent ? parent.width : 0
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    wrapMode: Text.WordWrap
  }

  // A row that reads as a switch without pulling in a control library the
  // rest of this plugin does not use.
  component ToggleRow: Rectangle {
    id: toggle

    property string label: ""
    property string hint: ""
    property bool checked: false
    property color swatch: "transparent"

    signal activated()

    width: parent ? parent.width : 0
    height: toggleBody.height + Style.space(6)
    radius: Style.cornerRadius
    color: hovered.hovered ? root.quiet(0.06) : "transparent"

    HoverHandler { id: hovered }
    TapHandler { onTapped: toggle.activated() }

    Row {
      id: toggleBody
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.leftMargin: Style.space(3)
      anchors.rightMargin: Style.space(3)
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(4)

      Text {
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(14)
        text: toggle.checked ? "✓" : ""
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        visible: toggle.swatch.a > 0
        width: Style.space(4)
        height: width
        radius: width / 2
        color: toggle.checked ? toggle.swatch : "transparent"
        border.width: Style.spacing.hairline
        border.color: toggle.swatch
      }

      Column {
        anchors.verticalCenter: parent.verticalCenter
        width: toggleBody.width - Style.space(26)
        spacing: Style.space(1)

        Text {
          width: parent.width
          // Calendar names come from the events file, so a shared calendar or
          // a third-party writer chooses this string, not the plugin.
          textFormat: Text.PlainText
          text: toggle.label
          color: toggle.checked ? root.foreground : root.muted
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          elide: Text.ElideRight
        }

        Text {
          width: parent.width
          visible: toggle.hint !== ""
          text: toggle.hint
          color: root.faint
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: Text.WordWrap
        }
      }
    }
  }

  // One choice of several, as a pill.
  component Pill: Rectangle {
    id: pill

    property string label: ""
    property bool active: false

    signal activated()

    width: pillLabel.width + Style.space(8)
    height: pillLabel.height + Style.space(4)
    radius: height / 2
    color: active ? root.quiet(0.14) : "transparent"
    border.width: Style.spacing.hairline
    border.color: active ? root.muted : root.quiet(0.36)

    Text {
      id: pillLabel
      anchors.centerIn: parent
      text: pill.label
      color: pill.active ? root.foreground : root.faint
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }

    HoverHandler { cursorShape: Qt.PointingHandCursor }
    TapHandler { onTapped: pill.activated() }
  }

  // ---- Calendars

  SectionTitle { text: root.tr("settings.calendars") }

  Note {
    visible: root.calendars.length === 0
    text: root.tr("settings.noCalendars")
  }

  Repeater {
    model: root.calendars

    ToggleRow {
      required property var modelData

      label: modelData.name
      swatch: modelData.color
      checked: root.hiddenCalendars.indexOf(modelData.id) === -1
      onActivated: root.calendarToggled(modelData.id)
    }
  }

  // ---- Display

  SectionTitle { text: root.tr("settings.display") }

  ToggleRow {
    label: root.tr("settings.weekMonday")
    hint: root.tr("settings.weekMondayHint")
    checked: root.weekStartsMonday
    onActivated: root.weekStartToggled()
  }

  ToggleRow {
    label: root.tr("settings.workingLocation")
    hint: root.tr("settings.workingLocationHint")
    checked: root.showWorkingLocation
    onActivated: root.workingLocationToggled()
  }

  ToggleRow {
    // Every row on this page reads "checked means shown". Phrasing this one as
    // "Hide ..." inverted that and made the page contradict itself.
    label: root.tr("settings.declined")
    hint: root.tr("settings.declinedHint")
    checked: !root.hideDeclined
    onActivated: root.hideDeclinedToggled()
  }

  // The panel cannot turn writing on by itself: it needs a Google sign-in
  // in a terminal. So the row shows the state and hands over the command.
  ToggleRow {
    label: root.tr("settings.write")
    hint: root.tr(root.canWrite
      ? "settings.writeOn"
      : root.writeSetupCopied ? "settings.writeCopied" : "settings.writeOff")
    checked: root.canWrite
    onActivated: if (!root.canWrite) root.writeSetupCopyRequested()
  }

  ToggleRow {
    label: root.tr("settings.progress")
    hint: root.tr("settings.progressHint")
    checked: root.showYearProgress
    onActivated: root.yearProgressToggled()
  }

  // ---- Language

  SectionTitle { text: root.tr("settings.language") }

  Note { text: root.tr("settings.languageHint") }

  Flow {
    width: parent.width
    spacing: Style.space(3)

    Repeater {
      model: Strings.languageOptions(root.language)

      Pill {
        required property var modelData
        label: modelData.label
        active: modelData.value === root.languageSetting
        onActivated: root.languagePicked(modelData.value)
      }
    }
  }

  // ---- Bar

  SectionTitle { text: root.tr("settings.barLabel") }

  Note { text: root.tr("settings.barLabelHint") }

  Flow {
    width: parent.width
    spacing: Style.space(3)

    Repeater {
      model: [0, 5, 15, 30, 60]

      Pill {
        required property int modelData
        label: modelData === 0 ? root.tr("settings.never") : root.tr("settings.minutes", [modelData])
        active: modelData === root.announceLeadMinutes
        onActivated: root.leadMinutesPicked(modelData)
      }
    }
  }

  // ---- Sync status. Read-only on purpose: changing the Google account is an
  //      OAuth browser flow, which belongs to sync/setup and not to a popup
  //      in a status bar. What belongs here is knowing whether it is working.

  SectionTitle { text: root.tr("settings.sync") }

  Note {
    readonly property bool missing: root.syncState === "missing"

    // Concatenates sourceLabel, which is whatever wrote the events file.
    textFormat: Text.PlainText
    color: missing && syncHover.hovered ? root.foreground : root.faint
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
