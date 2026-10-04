import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Strings.js" as Strings

// The bar clock, the host for the calendar panel, and the source of event
// reminders. The clock is never traded away: an upcoming event is announced
// next to it, quietly inside the lead time, in the accent colour with a Join
// chip in the last 10 minutes, and in the urgent colour for the first 2
// minutes after it starts.
//
// Left click toggles the panel, middle click joins the current or next
// meeting, right click walks the common label formats.
BarWidget {
  id: root
  moduleName: "tmn73.calendar"

  property date displayDate: clock.date
  readonly property real nowMs: displayDate.getTime()

  readonly property string language: Strings.resolveLanguage(setting("language", "auto"), Qt.locale().name)

  readonly property string configuredFormat: vertical
    ? setting("verticalFormat", "HH\n—\nmm")
    : setting("format", "dddd HH:mm")
  readonly property string configuredAltFormat: vertical
    ? setting("verticalFormatAlt", "dd\nMMM\n'W'ww\n''yy")
    : setting("formatAlt", "d MMMM 'W'ww yyyy")
  readonly property var formatRing: Model.clockFormatRing(configuredFormat, configuredAltFormat, Model.clockFormats(vertical))

  // ---- Events. Read here rather than off the panel so the label and the
  //      reminders keep working whether or not the panel was ever opened.
  property var allEvents: []
  readonly property var hiddenCalendars: {
    var stored = setting("hiddenCalendars", [])
    return Array.isArray(stored) ? stored : []
  }
  readonly property var visibleEvents: Model.visibleEvents(allEvents, hiddenCalendars, {
    hideWorkingLocation: true,
    hideDeclined: true
  })

  readonly property var barState: Model.barState(visibleEvents, nowMs, setting("announceLeadMinutes", 15))
  readonly property bool announcing: !vertical && barState.phase !== "idle"
  readonly property bool urgent: barState.phase === "live"
  readonly property bool emphasized: barState.phase === "imminent" || urgent
  readonly property string barMeetingUrl: emphasized ? Model.meetingUrlFor(barState.event) : ""
  readonly property color phaseColor: urgent ? (bar ? bar.urgent : Color.urgent) : Color.accent

  readonly property string clockText: formatted(displayDate)
  readonly property var verticalLines: clockText.split("\n")

  function applyEvents(raw) {
    var events = []
    try {
      var doc = JSON.parse(raw)
      if (doc && doc.version === 1 && Array.isArray(doc.events)) events = doc.events
    } catch (error) {}
    root.allEvents = events
  }

  function refresh() {
    displayDate = new Date()
    eventsFile.reload()
    if (panelLoader.item && panelLoader.item.refresh) panelLoader.item.refresh()
  }

  function cycleFormat() {
    var current = String(configuredFormat)
    var next = Model.nextClockFormat(formatRing, current)
    if (next === "" || next === current) return

    var entry = { id: root.moduleName }
    for (var key in root.settings) if (key !== "id") entry[key] = root.settings[key]
    entry[vertical ? "verticalFormat" : "format"] = next

    // Applied locally first so the label changes on the click itself; the
    // shell.json write comes back through the bar as the same value.
    root.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function formatted(date) {
    return Qt.locale(Strings.localeName(root.language)).toString(date, configuredFormat.replace(/ww/g, Model.isoWeekLiteral(date.getFullYear(), date.getMonth(), date.getDate())))
  }

  function join(event) {
    var url = Model.meetingUrlFor(event || Model.meetingToJoin(visibleEvents, Date.now(), barState.event))
    if (url) Qt.openUrlExternally(url)
    else reminders.notice(Strings.tr(language, "toast.noMeeting"))
  }

  // ---- Reminders. One widget exists per monitor; the first one sends, and
  //      the panel on any screen reaches it through these.
  function primaryWidget() {
    var widgets = bar && typeof bar.moduleWidgets === "function" ? bar.moduleWidgets(moduleName) : []
    return widgets.length > 0 && widgets[0] ? widgets[0] : root
  }

  readonly property var recentlyFired: reminders.recentlyFired

  function canSnooze(event, nowMs) {
    return reminders.canSnooze(event, nowMs)
  }

  function snooze(event, minutes) {
    var primary = primaryWidget()
    if (primary !== root && primary.snooze) primary.snooze(event, minutes)
    else reminders.snooze(event, minutes)
  }

  // ---- Calendar popup. Shape contract for shell.summon/hide/toggle
  //      routing: Bar.findPanelWidget requires open/close/opened on the
  //      bar-widget root.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function toggleWeekStart() {
    if (panelLoader.item) panelLoader.item.toggleWeekStart()
  }

  // The open-panel dot lines up with the painted label horizontally and
  // takes one icon line vertically, the same mark icon widgets get.
  readonly property real openPanelIndicatorWidth: vertical ? 0 : clockLabel.implicitWidth
  readonly property real openPanelIndicatorHeight: Math.max(Style.space(10), Math.round(Style.bar.iconSlot * 0.55))

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  SystemClock {
    id: clock
    precision: SystemClock.Minutes
    onDateChanged: root.displayDate = date
  }

  FileView {
    id: eventsFile
    path: (Quickshell.env("HOME") || "") + "/.local/state/omarchy/calendar-events.json"
    watchChanges: true
    printErrors: false
    onLoaded: root.applyEvents(text())
    onLoadFailed: root.applyEvents("")
    onFileChanged: reload()
  }

  Reminders {
    id: reminders
    events: root.visibleEvents
    enabled: root.setting("reminders", true) !== false
    language: root.language
    timeFormat: String(root.setting("eventTimeFormat", "HH:mm") || "HH:mm")
    isLeader: function() { return root.primaryWidget() === root }
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "tmn73.calendar"

    function refresh(): void { root.broadcast("refresh") }
    function cycleFormat(): void { root.cycleFormat() }
    function toggleWeekStart(): void { root.toggleWeekStart() }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function join(): void { root.join(null) }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.vertical ? "" : root.clockText
    labelVisible: false
    hasVisualContent: root.vertical ? root.verticalLines.length > 0 : text !== ""
    fixedWidth: root.vertical ? -1 : content.implicitWidth + scaledHorizontalMargin * 2
    fixedHeight: root.vertical ? root.verticalLines.length * Style.bar.iconSlot : -1
    horizontalMargin: 8.75
    verticalPadding: 8.75
    tooltipText: root.announcing
      ? Model.text(root.barState.event.title) + "\n" + Strings.tr(root.language, "bar.tooltip")
      : Strings.tr(root.language, "bar.tooltip")

    onPressed: function(b) {
      if (b === Qt.RightButton) root.cycleFormat()
      else if (b === Qt.MiddleButton) root.join(null)
      else root.togglePanel()
    }

    Row {
      id: content
      visible: !root.vertical
      anchors.centerIn: parent
      spacing: Style.space(8)

      BarText {
        id: clockLabel
        text: root.clockText
        color: button.foreground
        font.family: button.fontFamily
        font.pixelSize: button.fontSize
      }

      BarText {
        visible: root.announcing
        text: "│"
        color: button.foreground
        opacity: 0.35
        font: clockLabel.font
      }

      Rectangle {
        visible: root.announcing && root.urgent
        anchors.verticalCenter: parent.verticalCenter
        width: Math.round(button.fontSize * 0.6)
        height: width
        radius: width / 2
        color: root.phaseColor
      }

      BarText {
        visible: root.announcing
        text: Model.barLabel(root.barState, root.language)
        color: root.emphasized ? root.phaseColor : button.foreground
        opacity: root.emphasized ? 1 : 0.78
        font.family: button.fontFamily
        font.pixelSize: button.fontSize
        font.weight: root.emphasized ? Font.DemiBold : Font.Normal
      }

      Chip {
        visible: root.announcing && root.barMeetingUrl !== ""
        text: Strings.tr(root.language, "bar.join")
        fontFamily: button.fontFamily
        lineHeight: button.fontSize
        fill: root.phaseColor
        interactive: true
        onClicked: root.join(root.barState.event)
      }

      Chip {
        visible: root.announcing && root.barState.extra > 0
        text: Strings.tr(root.language, "bar.more", [root.barState.extra])
        fontFamily: button.fontFamily
        lineHeight: button.fontSize
        fill: Qt.rgba(button.foreground.r, button.foreground.g, button.foreground.b, 0.6)
      }
    }

    Column {
      visible: root.vertical
      anchors.fill: parent

      Repeater {
        model: root.verticalLines

        OpticalGlyph {
          required property string modelData
          width: button.width
          height: Style.bar.iconSlot
          text: modelData
          fontFamily: button.fontFamily
          fontSize: modelData.length > 3
            ? button.fontSize * 0.9
            : button.fontSize
          color: root.emphasized ? root.phaseColor : button.foreground
        }
      }
    }
  }

  component BarText: Text {
    anchors.verticalCenter: parent ? parent.verticalCenter : undefined
    textFormat: Text.PlainText
    renderType: Text.NativeRendering
  }

  // A small filled pill: the Join button and the "+N" badge. Only an
  // interactive chip takes the left click; anything else falls through to
  // the widget, so the panel, middle and right click work on top of it.
  component Chip: Rectangle {
    id: chip
    property alias text: chipLabel.text
    property string fontFamily: Style.font.family
    property real lineHeight: Style.font.body
    property color fill: Color.accent
    property bool interactive: false
    signal clicked()

    anchors.verticalCenter: parent ? parent.verticalCenter : undefined
    implicitWidth: chipLabel.implicitWidth + Style.space(8) * 2
    implicitHeight: Math.round(lineHeight * 1.6)
    radius: Math.round(height / 4)
    color: fill

    Text {
      id: chipLabel
      anchors.centerIn: parent
      textFormat: Text.PlainText
      color: Color.background
      font.family: chip.fontFamily
      font.pixelSize: Style.font.caption
      font.weight: Font.Bold
      renderType: Text.NativeRendering
    }

    MouseArea {
      anchors.fill: parent
      enabled: chip.interactive
      acceptedButtons: Qt.LeftButton
      cursorShape: Qt.PointingHandCursor
      onClicked: chip.clicked()
    }
  }
}
