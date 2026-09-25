import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The clock's calendar popup: a month grid with ISO week numbers, built to
// sit beside the weather panel — same hero-over-detail composition, same
// spacing scale, same small-caps labels.
//
// The grid is a read-out rather than a picker: today is the only marked
// day, and the only thing that moves is which month is on screen —
// chevrons, the scroll wheel, and the arrow keys all step it.
//
// BarWidget.qml owns the bar label and hands this panel the button to
// anchor against.
Panel {
  id: root
  moduleName: "tmn73.calendar"
  ipcTarget: "tmn73.calendar"
  manageIpc: false

  property var anchorItem: null

  // The bar tracks the widget mounted in its slot — BarWidget.qml — not this
  // nested panel. Everything the bar identifies a panel by has to be that
  // widget: the popout coordinator (and with it the open-panel dot under the
  // pill) compares against `slot.activeItem`, and switchPanelFrom looks the
  // slot up the same way.
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  // ---- Today. SystemClock keeps this honest across midnight so the
  //      highlight rolls over without the panel being reopened.
  property date today: new Date()
  readonly property string todayKey: Model.keyForDate(today)

  // The month on screen. Stepping moves this and nothing else: the grid is
  // a read-out, not a picker, so there is no per-day cursor to keep in sync.
  property int viewYear: today.getFullYear()
  property int viewMonth: today.getMonth()

  readonly property date viewDate: new Date(viewYear, viewMonth, 1)
  readonly property bool viewingCurrentMonth: viewYear === today.getFullYear() && viewMonth === today.getMonth()

  // Pinned to today, not to the month being browsed — stepping through the
  // calendar does not change how much of the year is gone.
  readonly property real yearDone: Model.yearProgress(today.getFullYear(), today.getMonth(), today.getDate())
  readonly property int yearDonePercent: Model.yearProgressPercent(today.getFullYear(), today.getMonth(), today.getDate())

  // Memento mori, for anyone who goes looking: double-tapping the year bar
  // asks for a birth year and a life expectancy, and a second bar tracks one
  // against the other. A birth year rather than an age, so it keeps counting
  // on its own. Without one the bar stays hidden.
  readonly property int birthYear: Model.parseBirthYear(setting("birthYear", 0), today.getFullYear())
  readonly property int age: Model.ageFromBirthYear(birthYear, today.getFullYear())
  readonly property int lifeExpectancy: Model.parseLifeExpectancy(setting("lifeExpectancy", 0))
  readonly property real lifeDone: Model.lifeProgress(age, lifeExpectancy)
  readonly property int lifeDonePercent: Model.lifeProgressPercent(age, lifeExpectancy)
  property bool editingLife: false

  // Unset falls through to the locale's own first day, so a fresh install
  // starts out matching the rest of the desktop rather than a hardcoded
  // convention. Clicking the grid's "W" heading writes the choice back to
  // shell.json.
  readonly property int weekStart: Model.normalizedWeekStart(setting("weekStartDay", null), Qt.locale().firstDayOfWeek)
  readonly property string nextWeekStartLabel: Qt.locale().dayName(Model.toggledWeekStart(weekStart), Locale.LongFormat)
  readonly property var weekdays: Model.weekdayOrder(weekStart)
  readonly property var weeks: Model.monthGrid(viewYear, viewMonth, weekStart, todayKey, eventIndex)

  // ---- Events, read from whatever wrote the state file. The panel never
  //      learns where they came from: Google, khal, an ICS feed and a shell
  //      script all look identical from here.
  property var eventDoc: null
  property var eventIndex: ({})
  property bool eventVersionMismatch: false

  // Matches the sync timer's interval. Model.syncState allows four of these
  // to elapse before calling the file stale, so one missed run stays quiet.
  readonly property int syncIntervalSeconds: 300

  // Spelled out in full because the people who need it are the ones who
  // installed from the marketplace listing and never opened the README.
  // Resolved from this file's own location, so it is right whether the plugin
  // was installed by `omarchy plugin add` or cloned somewhere by hand.
  readonly property string setupCommand: Model.commandPathFromUrl(
    Qt.resolvedUrl("sync/setup"), Quickshell.env("HOME") || "")
  readonly property string writeSetupCommand: root.setupCommand + " --write"

  // ---- Writing. The sync lists the calendars the panel may change; with no
  //      list there is no "+", no pencil and no trash can.
  readonly property var writableCalendars: (eventDoc && eventDoc.writableCalendars) || []
  readonly property bool canWrite: writableCalendars.length > 0
  property bool formOpen: false
  // The form the event form opens with: a get's reply, or a new one.
  property var formInitial: null
  property bool writeBusy: false
  property string writeError: ""
  // What the running command is for: "edit" and "delete" run a get first,
  // "save" and "remove" are the writes.
  property string pendingPurpose: ""
  // The event a plain delete waits to confirm, as a form.
  property var pendingDelete: null
  // The open two-answer question, if any; see ask().
  property string choiceMessage: ""
  property string choiceFirst: ""
  property string choiceSecond: ""
  property var choiceCallback: null

  // Only ever this file, next to this plugin. Never a path from the events
  // file: any program can write that file.
  readonly property string eventCommand: Model.localPathFromUrl(
    Qt.resolvedUrl("sync/omarchy-calendar-event"))
  readonly property string syncState: eventVersionMismatch
    ? "version"
    : Model.syncState(eventDoc, Date.now(), syncIntervalSeconds)

  // The day whose agenda is listed under the grid. The upstream clock had no
  // cursor at all, so this is the one place the fork departs from it.
  property string selectedDayKey: todayKey
  readonly property var selectedEvents: Model.eventsForDateKey(eventIndex, selectedDayKey)
  readonly property date selectedDate: Model.dateFromKey(selectedDayKey, today)
  readonly property string eventTimeFormat: String(setting("eventTimeFormat", "HH:mm") || "HH:mm")

  // Where "now" falls in the listed day. -1 on any other day: a line on
  // yesterday's agenda would claim a position it does not have.
  readonly property int nowLineIndex: selectedDayKey === todayKey
    ? Model.nowLineIndex(selectedEvents, nowTick.getTime())
    : -1

  // The agenda's "now" marker: a dot on the rail, the time in the time
  // column, and a hairline across the rest. Its own component because it
  // appears both above a row and after the last one.
  component NowLine: Row {
    property color accent
    property string fontFamily
    property int railWidth
    property int timeWidth
    property string timeFormat: "HH:mm"
    property int columnSpacing
    property date now

    spacing: columnSpacing

    Rectangle {
      width: railWidth * 3
      height: width
      radius: width / 2
      anchors.verticalCenter: parent.verticalCenter
      color: accent
    }

    Text {
      width: timeWidth - railWidth * 2
      text: Qt.formatDateTime(now, timeFormat)
      color: accent
      font.family: fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
    }

    Rectangle {
      width: parent.width - railWidth - timeWidth - columnSpacing * 2
      height: Style.spacing.hairline
      anchors.verticalCenter: parent.verticalCenter
      color: accent
    }
  }

  function selectDay(key) {
    root.selectedDayKey = String(key)
  }

  function applyEvents(raw) {
    var doc = null
    var mismatch = false

    if (raw) {
      try {
        var parsed = JSON.parse(raw)
        if (parsed && parsed.version === 1) {
          doc = parsed
        } else if (parsed && parsed.version !== undefined) {
          // Written by a newer sync than this widget understands. Say so
          // rather than render an empty month that reads as a quiet week.
          mismatch = true
        }
      } catch (error) {
        doc = null
      }
    }

    root.eventDoc = doc
    root.eventVersionMismatch = mismatch
    root.rebuildIndex()
  }

  // Flat, already filtered. BarWidget.qml reads this to work out what is
  // coming up next, so the bar label can count down without the popup ever
  // being opened.
  property var visibleEventList: []

  function rebuildIndex() {
    var all = root.eventDoc ? root.eventDoc.events : []
    root.visibleEventList = Model.visibleEvents(all, root.hiddenCalendars, {
      hideWorkingLocation: !root.showWorkingLocation,
      hideDeclined: root.hideDeclined
    })
    root.eventIndex = Model.indexEventsByDate(root.visibleEventList)
  }

  // Ticks every minute regardless of whether the day rolled over, which is
  // what a countdown needs. `today` deliberately only moves at midnight.
  property date nowTick: new Date()
  readonly property var upcomingEvent: Model.nextEventToday(visibleEventList, nowTick.getTime(), todayKey)

  // The year and life bars are the upstream clock's, kept but opt-in. What
  // most people want in that slot is what is coming up next, not how much of
  // the year is gone.
  readonly property bool showYearProgress: setting("showYearProgress", false)

  // Google's working-location markers arrive as all-day events and describe no
  // commitment, so they are out by default. Declined invitations stay in by
  // default: you probably still want to see what you said no to.
  readonly property bool showWorkingLocation: setting("showWorkingLocation", false)
  readonly property bool hideDeclined: setting("hideDeclined", false)

  // Hiding happens here rather than in the sync, so toggling a calendar back
  // on is instant instead of waiting for the next fetch. The sync keeps
  // pulling everything.
  //
  // Held as local state rather than read straight off `settings` on every
  // access. Persisting round-trips through shell.json and comes back
  // asynchronously, so a binding would still be serving the old value when a
  // second click arrives, and the first toggle would be silently undone.
  property var hiddenCalendars: []
  readonly property var knownCalendars: Model.calendarsInDocument(eventDoc)

  function adoptSettings() {
    var stored = setting("hiddenCalendars", [])
    root.hiddenCalendars = Array.isArray(stored) ? stored.slice() : []
  }

  function toggleCalendar(calendarId) {
    root.hiddenCalendars = Model.toggleHiddenCalendar(root.hiddenCalendars, calendarId)
    persistSettings({ hiddenCalendars: root.hiddenCalendars })
  }

  function toggleYearProgress() {
    persistSettings({ showYearProgress: !root.showYearProgress })
  }

  function setAnnounceLeadMinutes(minutes) {
    persistSettings({ announceLeadMinutes: minutes })
  }

  property bool settingsOpen: false

  function toggleWorkingLocation() {
    persistSettings({ showWorkingLocation: !root.showWorkingLocation })
  }

  function toggleHideDeclined() {
    persistSettings({ hideDeclined: !root.hideDeclined })
  }

  // Qt.openUrlExternally rather than the shell helper on purpose. That helper
  // runs `bash -lc`, and a meeting link is supplied by whoever sent the
  // invitation, so putting it through a shell would be a command injection.
  // Model.safeUrl also refuses anything that is not plain https.
  function openExternally(url) {
    if (!url) return
    Qt.openUrlExternally(url)
    root.close()
  }

  function openMeeting(event) {
    root.openExternally(Model.meetingUrlFor(event))
  }

  // Clicking the row opens the event itself. Joining is the button's job, so
  // both actions stay reachable while a meeting is live.
  function openEvent(event) {
    root.openExternally(Model.eventUrlFor(event))
  }

  onHiddenCalendarsChanged: root.rebuildIndex()
  onShowWorkingLocationChanged: root.rebuildIndex()
  onHideDeclinedChanged: root.rebuildIndex()
  onSettingsChanged: root.adoptSettings()
  Component.onCompleted: root.adoptSettings()


  // Guarded so the widget renders before the bar is injected (the bar-widget
  // contract instantiates it bare).
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family

  // De-emphasis that survives a light theme. Qt.darker on the foreground only
  // reads as "quieter" while the background is darker than the text; against a
  // light background it raises contrast instead, so on a light theme every
  // receding element here stopped receding -- week numbers, weekday headings,
  // the month label, out-of-month days, weekends and declined invitations all
  // came forward rather than back. Fading the foreground toward whatever sits
  // behind it is the one form that works in both directions.
  //
  // `amount` is an opacity: 1.0 is the plain foreground, lower is quieter.
  function quiet(amount) {
    return Qt.rgba(contentForeground.r, contentForeground.g, contentForeground.b, amount)
  }

  readonly property int cellWidth: Style.space(52)
  readonly property int cellHeight: Style.space(34)
  readonly property int cellSpacing: Style.space(2)
  readonly property int weekColumnWidth: Style.space(32)
  readonly property int gutterWidth: Style.space(14)
  readonly property int eventTimeColumnWidth: Math.ceil(Math.max(
    allDayTimeMetrics.tightBoundingRect.width,
    morningTimeMetrics.tightBoundingRect.width,
    eveningTimeMetrics.tightBoundingRect.width
  )) + Style.space(2)

  TextMetrics {
    id: allDayTimeMetrics
    font.family: root.contentFontFamily
    font.pixelSize: Style.font.bodySmall
    text: qsTr("All day")
  }

  TextMetrics {
    id: morningTimeMetrics
    font.family: root.contentFontFamily
    font.pixelSize: Style.font.bodySmall
    text: Qt.formatDateTime(new Date(2000, 0, 1, 0, 59), root.eventTimeFormat)
  }

  TextMetrics {
    id: eveningTimeMetrics
    font.family: root.contentFontFamily
    font.pixelSize: Style.font.bodySmall
    text: Qt.formatDateTime(new Date(2000, 0, 1, 23, 59), root.eventTimeFormat)
  }

  function open() {
    refresh()
    root.controller.show()
    // Set after showing, not before: showing hands the popout coordinator
    // over, which closes whichever panel was open, and that close clears the
    // shared flag. Deferring means the panel taking over always wins, while
    // a handoff to a panel that does not manage the flag still leaves it
    // cleared rather than stuck on.
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    // Put the panel away before anything else. The popup is a full-screen
    // overlay holding keyboard focus, so a throw anywhere above this line
    // leaves the desktop with no way to take a key or a click back.
    root.controller.hide()
    setCenterHoverRevealSuppressed(false)
    // Dismissing the panel mid-edit would otherwise leave the inputs up,
    // waiting behind a closed popup for the next time it opens.
    if (root.editingLife) root.cancelEditingLife()
    if (root.formOpen) root.closeForm()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  // Summoning by hotkey moves no pointer, so a hover the bar was still
  // holding must not keep the center indicators revealed behind the panel.
  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
      root.bar.setCenterHoverRevealSuppressed(value)
    else if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  function refresh() {
    root.today = new Date()
    root.goToToday()
  }

  function goToToday() {
    root.viewYear = today.getFullYear()
    root.viewMonth = today.getMonth()
  }

  function moveMonth(delta) {
    var next = Model.stepMonth(viewYear, viewMonth, delta)
    root.viewYear = next.year
    root.viewMonth = next.month
  }

  function moveYear(delta) {
    moveMonth(delta * 12)
  }

  // Applied locally first so the panel redraws on the click itself; the
  // shell.json write comes back through the bar as the same value. With no
  // writable entry (the widget is not in the layout) it stays a session-only
  // preference rather than doing nothing. The host widget builds its own
  // entry when the label format is cycled, so it has to be kept in step or
  // it would write this key straight back out from a stale copy.
  function persistSettings(values) {
    var entry = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entry[existing] = root.settings[existing]
    for (var key in values) entry[key] = values[key]

    root.settings = entry
    if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function setWeekStart(day) {
    var next = Model.normalizedWeekStart(day, root.weekStart)
    if (next === root.weekStart) return
    persistSettings({ weekStartDay: Model.weekStartSettingName(next) })
  }

  function startEditingLife() {
    root.editingLife = true
    Qt.callLater(function() {
      bornField.text = root.birthYear > 0 ? String(root.birthYear) : ""
      expectancyField.text = String(root.lifeExpectancy)
      bornField.selectAll()
      bornField.forceActiveFocus()
    })
  }

  function cancelEditingLife() {
    root.editingLife = false
    Qt.callLater(function() { if (keyCatcher) keyCatcher.forceActiveFocus() })
  }

  // Shared by both fields: Tab hops to the other one, Enter commits the pair,
  // Escape drops the lot.
  function handleLifeKey(event, other) {
    if (event.key === Qt.Key_Escape) {
      root.cancelEditingLife()
      event.accepted = true
    } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
      root.commitLife()
      event.accepted = true
    } else if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
      other.selectAll()
      other.forceActiveFocus()
      event.accepted = true
    }
  }

  // Double-tapping the life bar puts it away again. The expectancy stays in
  // the config so setting a birth year again brings your own number back
  // rather than the default.
  function clearLife() {
    if (root.birthYear <= 0) return
    persistSettings({ birthYear: 0 })
  }

  function commitLife() {
    var born = Model.parseBirthYear(bornField.text, today.getFullYear())
    var span = Model.parseLifeExpectancy(expectancyField.text)
    if (born !== root.birthYear || span !== root.lifeExpectancy)
      persistSettings({ birthYear: born, lifeExpectancy: span })
    cancelEditingLife()
  }

  function toggleWeekStart() {
    setWeekStart(Model.toggledWeekStart(root.weekStart))
  }

  // Locale short day names, trimmed of the trailing period some locales
  // carry ("man." -> "MAN") so the header row stays a clean band of caps.
  function weekdayLabel(weekday) {
    return String(Qt.locale().dayName(weekday, Locale.ShortFormat)).replace(/\.$/, "").toUpperCase()
  }

  // watchChanges is the point of this whole widget. The sync rewrites the
  // file every few minutes and the popup has to follow it without the shell
  // being restarted. There is deliberately no "already loaded" guard here:
  // one exists upstream in a similar plugin and it is exactly what made an
  // externally written file impossible to pick up.
  FileView {
    id: eventsFile
    path: (Quickshell.env("HOME") || "") + "/.local/state/omarchy/calendar-events.json"
    watchChanges: true
    printErrors: false
    onLoaded: root.applyEvents(text())
    onLoadFailed: root.applyEvents("")
    onFileChanged: reload()
  }

  // Copying beats reading a long path back to yourself. Argv array rather than
  // a shell string, so there is nothing to quote.
  Process {
    id: setupCommandCopier
    command: ["wl-copy", "--", root.setupCommand]
  }

  property bool setupCommandCopied: false

  function copySetupCommand() {
    setupCommandCopier.running = true
    root.setupCommandCopied = true
    copiedReset.restart()
  }

  Timer {
    id: copiedReset
    interval: 2000
    onTriggered: root.setupCommandCopied = false
  }

  Process {
    id: writeSetupCopier
    command: ["wl-copy", "--", root.writeSetupCommand]
  }

  function openForm(form) {
    if (!root.canWrite || !form) return
    root.settingsOpen = false
    root.writeError = ""
    root.formInitial = form
    root.formOpen = true
  }

  function newEvent() {
    if (!root.canWrite) return
    root.openForm(Model.newEventForm(
      root.selectedDayKey,
      Model.defaultFormTimes(root.selectedDayKey, root.nowTick),
      root.writableCalendars[0].id))
  }

  function closeForm() {
    root.formOpen = false
    root.formInitial = null
    root.writeError = ""
    Qt.callLater(function() { if (keyCatcher) keyCatcher.forceActiveFocus() })
  }

  // Edit and delete both read the whole event first: the file carries no
  // guests, repeat or description, and a delete needs to know about both.
  function editEvent(row) {
    root.runEvent({ action: "get", calendarId: row.calendarId, eventId: row.id }, "edit")
  }

  function deleteEvent(row) {
    root.runEvent({ action: "get", calendarId: row.calendarId, eventId: row.id }, "delete")
  }

  // One question with two answers; callback("first" or "second").
  function ask(message, firstText, secondText, callback) {
    root.choiceMessage = message
    root.choiceFirst = firstText
    root.choiceSecond = secondText
    root.choiceCallback = callback
  }

  function answerChoice(answer) {
    var callback = root.choiceCallback
    root.choiceMessage = ""
    root.choiceCallback = null
    if (callback && answer) callback(answer)
  }

  function saveForm(form) {
    var initial = root.formInitial || {}
    var choice = { scope: "this", sendUpdates: "none" }
    var series = String(form.recurringEventId || "") !== ""
    // A new repeat can only be a series edit, so it is not a question.
    if (series && form.repeat !== initial.repeat) choice.scope = "all"
    var askScope = series && form.repeat === initial.repeat

    function run() {
      root.runEvent({
        action: String(form.eventId || "") !== "" ? "update" : "create",
        scope: choice.scope,
        sendUpdates: choice.sendUpdates,
        event: form
      }, "save")
    }

    function askInvitations() {
      if (Model.otherGuests(form).length === 0) return run()
      root.ask(qsTr("Send invitation emails to the guests?"), qsTr("Send"), qsTr("Don't send"),
        function(answer) { choice.sendUpdates = answer === "first" ? "all" : "none"; run() })
    }

    if (askScope)
      root.ask(qsTr("Edit a recurring event"), qsTr("This event"), qsTr("All events"),
        function(answer) { choice.scope = answer === "first" ? "this" : "all"; askInvitations() })
    else
      askInvitations()
  }

  function startDelete(form) {
    var choice = { scope: "this", sendUpdates: "none" }
    var series = String(form.recurringEventId || "") !== ""
    var guests = Model.otherGuests(form).length > 0

    function run() {
      root.runEvent({
        action: "delete",
        calendarId: form.calendarId,
        eventId: form.eventId,
        recurringEventId: form.recurringEventId || "",
        scope: choice.scope,
        sendUpdates: choice.sendUpdates
      }, "remove")
    }

    function askCancellations() {
      if (!guests) return run()
      root.ask(qsTr("Send cancellation emails to the guests?"), qsTr("Send"), qsTr("Don't send"),
        function(answer) { choice.sendUpdates = answer === "first" ? "all" : "none"; run() })
    }

    if (series)
      root.ask(qsTr("Delete a recurring event"), qsTr("This event"), qsTr("All events"),
        function(answer) { choice.scope = answer === "first" ? "this" : "all"; askCancellations() })
    else if (guests)
      askCancellations()
    else
      // No question to ask, so the plain confirm, with its title.
      root.pendingDelete = { form: form, run: run }
  }

  function runEvent(request, purpose) {
    if (root.writeBusy) return
    root.writeBusy = true
    root.writeError = ""
    root.pendingPurpose = purpose
    // Argv, not a shell string: the title is typed by the user and can hold
    // anything.
    writeProcess.command = [root.eventCommand, JSON.stringify(request)]
    writeProcess.running = true
  }

  function onWriteReply(text) {
    root.writeBusy = false
    root.pendingDelete = null
    var purpose = root.pendingPurpose
    root.pendingPurpose = ""
    var reply = Model.parseWriteReply(text)
    if (!reply.ok) {
      root.writeError = reply.error
      return
    }
    if (purpose === "edit") root.openForm(reply.event)
    else if (purpose === "delete") root.startDelete(reply.event)
    // A write: the command rewrote the events file, and the file watch shows
    // the change.
    else if (root.formOpen) root.closeForm()
  }

  Process {
    id: writeProcess
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.onWriteReply(text)
    }
  }

  SystemClock {
    id: clock
    precision: SystemClock.Minutes
    onDateChanged: {
      // Always, so the countdown moves even when the day has not.
      root.nowTick = clock.date
      if (Model.keyForDate(clock.date) === String(root.todayKey)) return
      var followToday = root.viewingCurrentMonth
      root.today = clock.date
      if (followToday) root.goToToday()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(560))
    contentHeight: panel.fittedContentHeight(calendarColumn.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // Off while typing in the form, so an "n" in a title stays an "n".
      blocked: root.editingLife || root.formOpen
      onMoveRequested: function(dx, dy) {
        if (dx !== 0) root.moveMonth(dx)
        if (dy !== 0) root.moveYear(dy)
      }
      onActivateRequested: root.goToToday()
      // ConfirmDialog takes no keys, so Escape backs out of a pending delete
      // before it closes the panel.
      onCloseRequested: {
        if (root.choiceMessage !== "") root.answerChoice(null)
        else if (root.pendingDelete !== null) root.pendingDelete = null
        else root.close()
      }
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "[") root.moveMonth(-1)
        else if (t === "]") root.moveMonth(1)
        else if (t === "{") root.moveYear(-1)
        else if (t === "}") root.moveYear(1)
        else if (t === "t" || t === "T") root.goToToday()
        else if (t === "w" || t === "W") root.toggleWeekStart()
        else if ((t === "n" || t === "N") && root.canWrite) root.newEvent()
      }

      Flickable {
        id: calendarScroll
        anchors.fill: parent
        contentWidth: calendarColumn.width
        contentHeight: calendarColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height || contentWidth > width

        Column {
          id: calendarColumn
          // Never narrower than the grid. The popup width is capped to what
          // the screen allows, and a fixed seven-column grid would otherwise
          // lose its last days off the edge instead of scrolling.
          width: Math.max(calendarScroll.width, gridColumn.width)
          spacing: Style.space(8)

          // ---- Hero: today, centered. Once the view has stepped back
          //      it is also the way home — clicking the date you are
          //      looking for beats hunting for a reset button.
          Item {
            id: hero
            width: parent.width
            height: heroRow.height

            // Decorative, and deliberately outside the Style.font.* scale.
            // The icon is sized to read at the cap height of the date.
            readonly property int iconPixelSize: 48
            readonly property int datePixelSize: 52

            // The row is centred, so it has to clear the settings button on
            // both sides. A long date in a wide font ("September 12" in some
            // monospace fonts) ran under the button, so shrink both glyphs
            // together until the row fits. The spacing stays fixed.
            readonly property real availableWidth: width - 2 * (settingsButton.width + Style.space(8))
            readonly property real naturalGlyphWidth: heroIconMetrics.advanceWidth + heroDateMetrics.advanceWidth
            readonly property real fit: naturalGlyphWidth > 0
              ? Math.max(0.4, Math.min(1, (availableWidth - heroRow.spacing) / naturalGlyphWidth))
              : 1

            TextMetrics {
              id: heroIconMetrics
              text: heroIcon.text
              font.family: root.contentFontFamily
              font.pixelSize: hero.iconPixelSize
            }

            TextMetrics {
              id: heroDateMetrics
              text: heroDate.text
              font.family: root.contentFontFamily
              font.pixelSize: hero.datePixelSize
              font.bold: true
            }

            // Sits in the hero's right margin rather than in the row itself,
            // so turning it on and off never shifts the date off centre.
            PanelActionButton {
              id: settingsButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              iconText: root.settingsOpen ? "󰅖" : "󰒓"
              tooltipText: root.settingsOpen ? "Back to calendar" : "Settings"
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              onClicked: root.settingsOpen = !root.settingsOpen
            }

            Row {
              id: heroRow
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(22)

              Text {
                id: heroIcon
                // Baseline-aligned, not center-aligned: "July 26" carries a
                // descender, so centering the two boxes leaves the icon
                // sitting visibly low against the digits.
                anchors.baseline: heroDate.baseline
                text: "󰃭"
                color: heroMouse.containsMouse
                  ? Style.hoverStateColor(root.contentForeground, Color.accent)
                  : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Math.floor(hero.iconPixelSize * hero.fit)
              }

              Text {
                id: heroDate
                anchors.verticalCenter: parent.verticalCenter
                text: Qt.formatDate(root.today, "MMMM d")
                color: heroMouse.containsMouse
                  ? Style.hoverStateColor(root.contentForeground, Color.accent)
                  : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Math.floor(hero.datePixelSize * hero.fit)
                font.bold: true
              }
            }

            MouseArea {
              id: heroMouse
              x: heroRow.x
              y: heroRow.y
              width: heroRow.width
              height: heroRow.height
              enabled: !root.viewingCurrentMonth
              hoverEnabled: enabled
              cursorShape: Qt.PointingHandCursor
              onClicked: root.goToToday()

              PanelToolTip {
                visible: heroMouse.containsMouse
                text: "Back to today"
                fontFamily: root.contentFontFamily
              }
            }
          }

          // ---- Year progress, doubling as the rule under the hero:
          //      a plain hairline said nothing, and whole days done
          //      over days in the year says the same thing louder.
          Item {
            visible: !root.settingsOpen && (root.showYearProgress || root.editingLife)
            width: parent.width
            height: yearBlock.y + yearBlock.height

            Item {
              id: yearBlock
              y: Style.space(6)
              anchors.horizontalCenter: parent.horizontalCenter
              width: gridColumn.width
              height: Math.max(yearLabel.implicitHeight, Style.space(10))

              TapHandler {
                enabled: root.showYearProgress && !root.editingLife
                onDoubleTapped: root.startEditingLife()
              }

              Row {
                visible: root.editingLife
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(10)

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: "BORN"
                  color: root.quiet(0.68)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.letterSpacing: 1
                }

                TextField {
                  id: bornField
                  width: Style.space(70)
                  anchors.verticalCenter: parent.verticalCenter
                  placeholderText: "year"
                  foreground: root.contentForeground
                  font.family: root.contentFontFamily
                  inputMethodHints: Qt.ImhDigitsOnly

                  Keys.onPressed: function(event) { root.handleLifeKey(event, expectancyField) }
                }

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.verticalCenterOffset: 0
                  leftPadding: Style.space(6)
                  text: "LIVE TO"
                  color: root.quiet(0.68)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.letterSpacing: 1
                }

                TextField {
                  id: expectancyField
                  width: Style.space(60)
                  anchors.verticalCenter: parent.verticalCenter
                  placeholderText: "90"
                  foreground: root.contentForeground
                  font.family: root.contentFontFamily
                  inputMethodHints: Qt.ImhDigitsOnly

                  Keys.onPressed: function(event) { root.handleLifeKey(event, bornField) }
                }
              }

              Text {
                id: yearLabel
                visible: root.showYearProgress && !root.editingLife
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                text: root.today.getFullYear()
                color: root.quiet(0.68)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.letterSpacing: 1
              }

              Text {
                id: yearPercent
                visible: root.showYearProgress && !root.editingLife
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: root.yearDonePercent + "%"
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
              }

              Rectangle {
                id: yearTrack
                visible: root.showYearProgress && !root.editingLife
                anchors.left: yearLabel.right
                anchors.right: yearPercent.left
                anchors.leftMargin: Style.space(12)
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                height: Style.space(6)
                radius: Style.cornerRadius > 0 ? height / 2 : 0
                color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.12)

                Rectangle {
                  width: Math.round(parent.width * root.yearDone)
                  height: parent.height
                  radius: parent.radius
                  color: Style.selectedStateColor(root.contentForeground, Color.accent)

                  Behavior on width { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
                }
              }
            }
          }

          // ---- Memento mori. Only here once someone has gone looking and
          //      given an age; the same rail as the year above it, measured
          //      against a nominal lifetime.
          Item {
            visible: !root.settingsOpen && root.showYearProgress && root.birthYear > 0
            width: parent.width
            height: visible ? lifeBlock.height : 0

            Item {
              id: lifeBlock
              anchors.horizontalCenter: parent.horizontalCenter
              width: gridColumn.width
              height: Math.max(lifeLabel.implicitHeight, Style.space(10))

              Text {
                id: lifeLabel
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                text: "LIFE"
                color: root.quiet(0.68)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.letterSpacing: 1
              }

              Text {
                id: lifePercent
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: root.lifeDonePercent + "%"
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
              }

              Rectangle {
                anchors.left: lifeLabel.right
                anchors.right: lifePercent.left
                anchors.leftMargin: Style.space(12)
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                height: Style.space(6)
                radius: Style.cornerRadius > 0 ? height / 2 : 0
                color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.12)

                Rectangle {
                  width: Math.round(parent.width * root.lifeDone)
                  height: parent.height
                  radius: parent.radius
                  color: Style.selectedStateColor(root.contentForeground, Color.accent)

                  Behavior on width { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
                }
              }

              TapHandler {
                onDoubleTapped: root.clearLife()
              }

              MouseArea {
                id: lifeMouse
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.NoButton

                PanelToolTip {
                  visible: lifeMouse.containsMouse
                  text: "Memento Mori"
                  fontFamily: root.contentFontFamily
                }
              }
            }
          }

          // ---- Month grid: week numbers down a gutter on the left, then
          //      the seven day columns. Always six rows, so the popup is
          //      exactly as tall in February as it is in August.
          Item {
            visible: !root.settingsOpen && !root.formOpen
            width: parent.width
            height: gridColumn.y + gridColumn.height

            WheelHandler {
              onWheel: function(event) {
                // Horizontal wheels and touchpad side-scrolls report y === 0;
                // without this they would every one read as "next month".
                if (event.angleDelta.y === 0) return
                root.moveMonth(event.angleDelta.y > 0 ? -1 : 1)
              }
            }

            Column {
              id: gridColumn
              // The meter above is a solid rule; the grid needs room to
              // read as its own block rather than hanging off it.
              y: Style.space(18)
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(3)

              Row {
                id: headerRow
                spacing: root.cellSpacing

                // The week-number heading doubles as the week-start toggle.
                // It is the one control in the panel whose meaning is not
                // self-evident, so it carries a tooltip naming the day the
                // click will switch to.
                Rectangle {
                  width: root.weekColumnWidth
                  height: Style.space(16)
                  radius: Style.cornerRadius
                  color: weekStartMouse.containsMouse
                    ? Style.hoverFillFor(root.contentForeground, Color.accent)
                    : "transparent"

                  Text {
                    anchors.centerIn: parent
                    text: "W"
                    color: weekStartMouse.containsMouse
                      ? Style.hoverStateColor(root.contentForeground, Color.accent)
                      : root.quiet(0.50)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    font.letterSpacing: 1
                    font.bold: true
                  }

                  MouseArea {
                    id: weekStartMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.toggleWeekStart()
                  }

                  PanelToolTip {
                    visible: weekStartMouse.containsMouse
                    text: "Start weeks on " + root.nextWeekStartLabel
                    fontFamily: root.contentFontFamily
                  }
                }

                Item {
                  width: root.gutterWidth
                  height: Style.space(16)
                }

                Repeater {
                  model: root.weekdays

                  Text {
                    required property var modelData
                    width: root.cellWidth
                    height: Style.space(16)
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    text: root.weekdayLabel(modelData)
                    color: root.quiet(0.68)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    font.letterSpacing: 1
                    font.bold: true
                  }
                }
              }

              Repeater {
                model: root.weeks

                Row {
                  required property var modelData
                  spacing: root.cellSpacing

                  Text {
                    width: root.weekColumnWidth
                    height: root.cellHeight
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    text: modelData.week
                    color: root.quiet(0.50)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                  }

                  Item {
                    width: root.gutterWidth
                    height: root.cellHeight
                  }

                  Repeater {
                    model: modelData.days

                    Rectangle {
                      id: dayCell
                      required property var modelData

                      readonly property bool selected: modelData.key === root.selectedDayKey

                      width: root.cellWidth
                      height: root.cellHeight
                      radius: Style.cornerRadius
                      // Today is outlined, not filled: a lit-up block shouts
                      // over a grid this quiet. The selected day gets a faint
                      // wash instead, so the two marks never compete.
                      color: dayCell.selected
                        ? Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.10)
                        : "transparent"
                      border.width: modelData.today ? Style.spacing.hairline : 0
                      border.color: Style.normalBorderFor(root.contentForeground, Color.accent)

                      Text {
                        id: dayNumber
                        anchors.centerIn: parent
                        // Lifted just enough to clear the dots, and only on
                        // days that have any, so an empty month does not
                        // shift under the cursor.
                        anchors.verticalCenterOffset: modelData.hasEvent ? -Style.space(3) : 0
                        text: modelData.day
                        color: modelData.inMonth
                          ? (modelData.weekend ? root.quiet(0.70) : root.contentForeground)
                          : root.quiet(0.40)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.body
                        font.bold: modelData.today
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

                      TapHandler {
                        onTapped: root.selectDay(dayCell.modelData.key)
                      }
                    }
                  }
                }
              }
            }

            // Hairline down the week-number gutter, drawn only beside the
            // day rows so it does not cut through the header band.
            Rectangle {
              x: gridColumn.x + root.weekColumnWidth + root.cellSpacing + Math.round((root.gutterWidth - width) / 2)
              y: gridColumn.y + headerRow.height + gridColumn.spacing
              width: Style.spacing.hairline
              height: gridColumn.height - headerRow.height - gridColumn.spacing
              color: root.contentForeground
              opacity: 0.1
            }
          }

          // ---- Month stepping, spanning the grid it drives. The chevrons
          //      sit on the grid's outer bounds, the same edges the year
          //      rail above uses, so the row reads as the panel's other
          //      full-width rail instead of a cluster floating in space.
          //      The label is centered and fixed-width, so it holds still
          //      from "MAY" to "SEPTEMBER".
          Item {
            visible: !root.settingsOpen && !root.formOpen
            width: parent.width
            height: monthNav.height

            Item {
              id: monthNav
              anchors.horizontalCenter: parent.horizontalCenter
              width: gridColumn.width
              height: monthLabel.implicitHeight + Style.space(10)

              Text {
                id: monthLabel
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.verticalCenter: parent.verticalCenter
                // Fixed width so the chevrons hold still between a
                // "MAY 2026" and a "SEPTEMBER 2026".
                width: Style.space(130)
                horizontalAlignment: Text.AlignHCenter
                text: Qt.formatDate(root.viewDate, "MMMM yyyy").toUpperCase()
                color: root.quiet(0.72)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                font.letterSpacing: 1
              }

              PanelActionButton {
                // Pulled out by the button's own padding so the glyph, not
                // its hit box, lines up with the "2026" on the year rail.
                anchors.left: parent.left
                anchors.leftMargin: -Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                iconText: "󰅁"
                tooltipText: "Previous month"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                onClicked: root.moveMonth(-1)
              }

              PanelActionButton {
                anchors.right: parent.right
                anchors.rightMargin: -Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                iconText: "󰅂"
                tooltipText: "Next month"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                onClicked: root.moveMonth(1)
              }
            }
          }

          // ---- The selected day's agenda. Headed by its own date, because
          //      the selection survives stepping to another month and an
          //      undated list would then be a quiet lie.
          Column {
            visible: !root.settingsOpen && !root.formOpen
            width: gridColumn.width
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: Style.space(4)

            // The day's heading, with "+" at the right when writing is on. A
            // failed delete has no form to report into, so its error takes
            // the heading's place until the next write.
            Item {
              width: parent.width
              height: Math.max(dayHeading.implicitHeight,
                               addEventButton.visible ? addEventButton.height : 0)

              Text {
                id: dayHeading
                readonly property bool showsError: root.writeError !== "" && !root.formOpen
                anchors.left: parent.left
                anchors.right: addEventButton.visible ? addEventButton.left : parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: showsError
                  ? root.writeError
                  : root.writeBusy && !root.formOpen
                  ? qsTr("LOADING…")
                  : Qt.formatDate(root.selectedDate, "dddd d MMMM").toUpperCase()
                textFormat: Text.PlainText
                elide: Text.ElideRight
                color: showsError ? Color.urgent : root.quiet(0.72)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                font.letterSpacing: 1
                font.bold: true
              }

              PanelActionButton {
                id: addEventButton
                visible: root.canWrite
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                iconText: "󰐕"
                tooltipText: "New event (N)"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                onClicked: root.newEvent()
              }
            }

            Repeater {
              model: root.selectedEvents

              Column {
                id: agendaEntry
                required property var modelData
                required property int index

                width: gridColumn.width
                spacing: Style.space(4)

                NowLine {
                  visible: agendaEntry.index === root.nowLineIndex
                  width: parent.width
                  accent: Color.accent
                  fontFamily: root.contentFontFamily
                  railWidth: Style.space(2)
                  timeWidth: root.eventTimeColumnWidth
                  timeFormat: root.eventTimeFormat
                  columnSpacing: Style.space(4)
                  now: root.nowTick
                }

              // The hover wash lives on this wrapper, never inside the Row. A
              // Row lays out every visible child, so an anchored background
              // added as a Row child fights the layout and ejects the content.
              Rectangle {
                id: eventRow
                readonly property var modelData: agendaEntry.modelData
                // Past rows fade, the one you are in is washed, so the list
                // reads as a timeline and not just a list.
                readonly property string phase: Model.eventPhase(modelData, root.nowTick.getTime())

                readonly property string meetingUrl: Model.meetingUrlFor(modelData)
                readonly property bool declined: Model.isDeclined(modelData)
                // Only around the actual time. A Join button on next week's
                // meeting is noise that dilutes the one that matters.
                readonly property bool joinable: Model.isJoinableNow(modelData, root.nowTick.getTime(), root.todayKey)
                readonly property string eventUrl: Model.eventUrlFor(modelData)
                readonly property bool openable: eventUrl !== ""
                // Pencil and trash can on hover, for your own calendars only.
                readonly property bool writable: Model.isWritable(modelData, root.writableCalendars)
                readonly property bool showActions: eventHover.hovered && writable && !root.writeBusy

                width: gridColumn.width
                height: eventBody.height + Style.space(2)
                radius: Style.cornerRadius
                color: eventHover.hovered
                  ? Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                            root.contentForeground.b, 0.08)
                  : eventRow.phase === "now"
                    ? Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.10)
                    : "transparent"

                // Only rows that can actually do something respond to a click.
                // A writable row hovers too, for its pencil and trash can,
                // but the hand cursor stays for rows a click opens.
                HoverHandler {
                  id: eventHover
                  enabled: eventRow.openable || eventRow.joinable || eventRow.writable
                  cursorShape: eventRow.openable || eventRow.joinable
                    ? Qt.PointingHandCursor
                    : Qt.ArrowCursor
                }

                Rectangle {
                  id: joinButton
                  visible: eventRow.joinable
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  width: joinLabel.implicitWidth + Style.space(8)
                  height: joinLabel.implicitHeight + Style.space(3)
                  radius: height / 2
                  color: joinHover.hovered
                    ? Style.selectedStateColor(root.contentForeground, Color.accent)
                    : "transparent"
                  border.width: Style.spacing.hairline
                  border.color: joinHover.hovered
                    ? "transparent"
                    : root.quiet(0.46)

                  HoverHandler {
                    id: joinHover
                    cursorShape: Qt.PointingHandCursor
                  }

                  // Its own handler, declared on the button, so the grab
                  // happens here and the row's opener does not also fire.
                  TapHandler {
                    gesturePolicy: TapHandler.ReleaseWithinBounds
                    onTapped: root.openMeeting(eventRow.modelData)
                  }

                  Text {
                    id: joinLabel
                    anchors.centerIn: parent
                    text: qsTr("Join")
                    color: joinHover.hovered ? Color.background : root.quiet(0.72)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                  }
                }

                // "in 36min" on the next event, "25min left" on the one under
                // way. On the row rather than in a line of its own, so it is
                // never in doubt which event it counts to.
                Row {
                  id: rowActions
                  visible: eventRow.showActions
                  anchors.right: eventRow.joinable ? joinButton.left : parent.right
                  anchors.rightMargin: eventRow.joinable ? Style.space(4) : Style.space(2)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(2)

                  PanelActionButton {
                    iconText: "󰏫"
                    tooltipText: "Edit"
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                    onClicked: root.editEvent(eventRow.modelData)
                  }

                  PanelActionButton {
                    iconText: "󰩺"
                    tooltipText: "Delete"
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                    onClicked: root.deleteEvent(eventRow.modelData)
                  }
                }

                Text {
                  id: rowTimer
                  // The actions take the timer's place while hovered.
                  visible: text !== "" && !eventRow.declined && !eventRow.showActions
                  anchors.right: eventRow.joinable ? joinButton.left : parent.right
                  anchors.rightMargin: eventRow.joinable ? Style.space(4) : Style.space(2)
                  anchors.verticalCenter: parent.verticalCenter
                  text: Model.rowTimer(eventRow.modelData, root.upcomingEvent, root.nowTick.getTime())
                  color: eventRow.phase === "now"
                    ? Color.accent
                    : root.quiet(0.72)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.caption
                }

                Row {
                  id: eventBody
                  anchors.left: parent.left
                  anchors.right: rowActions.visible
                    ? rowActions.left
                    : rowTimer.visible
                      ? rowTimer.left
                      : (eventRow.joinable ? joinButton.left : parent.right)
                  anchors.rightMargin: rowActions.visible || rowTimer.visible || eventRow.joinable
                    ? Style.space(3)
                    : 0
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(4)
                  opacity: eventRow.phase === "past" ? 0.45 : 1

                  // Deliberately here and not on the row: this stops at the
                  // Join button's left edge, so the two hit areas cannot
                  // overlap. Two TapHandlers over one point would both fire
                  // and open two tabs.
                  TapHandler {
                    enabled: eventRow.openable
                    onTapped: root.openEvent(eventRow.modelData)
                  }

                Rectangle {
                  width: Style.space(2)
                  height: eventLines.height
                  radius: width / 2
                  color: eventRow.declined
                    ? Qt.darker(eventRow.modelData.color, 2.2)
                    : eventRow.modelData.color
                }

                Text {
                  id: eventTime
                  width: root.eventTimeColumnWidth
                  text: eventRow.modelData.allDay
                    ? qsTr("All day")
                    : Qt.formatDateTime(new Date(eventRow.modelData.start), root.eventTimeFormat)
                  color: eventRow.phase === "now" && !eventRow.declined
                    ? Color.accent
                    : root.quiet(eventRow.declined ? 0.40 : 0.68)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.strikeout: eventRow.declined
                }

                Column {
                  id: eventLines
                  width: Math.max(0, eventBody.width - eventTime.width - Style.space(10))
                  spacing: Style.space(1)

                  Text {
                    width: parent.width
                    textFormat: Text.PlainText
                    text: eventRow.modelData.title
                    color: eventRow.declined
                      ? root.quiet(0.46)
                      : root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                    font.strikeout: eventRow.declined
                    elide: Text.ElideRight
                  }

                  Text {
                    width: parent.width
                    visible: text !== ""
                    textFormat: Text.PlainText
                    text: {
                      if (eventRow.declined) return qsTr("Declined")
                      if (Model.isOutOfOffice(eventRow.modelData)) return qsTr("Out of office")
                      return eventRow.modelData.location
                    }
                    color: root.quiet(0.50)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }
                }
              }
              }
            }

            // After the last row once the day's events are all under way or
            // done -- the case where the list alone says least about the time.
            NowLine {
              visible: root.selectedEvents.length > 0
                && root.nowLineIndex === root.selectedEvents.length
              width: parent.width
              accent: Color.accent
              fontFamily: root.contentFontFamily
              railWidth: Style.space(2)
              timeWidth: root.eventTimeColumnWidth
              timeFormat: root.eventTimeFormat
              columnSpacing: Style.space(4)
              now: root.nowTick
            }

            // An empty day and a sync that never ran look identical unless
            // we say which one it is.
            Text {
              id: emptyState
              width: parent.width
              visible: root.selectedEvents.length === 0
              color: root.syncState === "missing" && emptyHover.hovered
                ? Style.hoverStateColor(root.contentForeground, Color.accent)
                : root.quiet(0.50)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap

              HoverHandler {
                id: emptyHover
                enabled: root.syncState === "missing"
                cursorShape: Qt.PointingHandCursor
              }

              TapHandler {
                enabled: root.syncState === "missing"
                onTapped: root.copySetupCommand()
              }
              text: root.syncState === "missing"
                ? (root.setupCommandCopied
                  ? qsTr("Copied. Paste it in a terminal:\n%1").arg(root.setupCommand)
                  : qsTr("No calendar synced yet. Click to copy, then run:\n%1").arg(root.setupCommand))
                : root.syncState === "version"
                  ? qsTr("Events file was written by a newer version. Update the plugin.")
                  : root.syncState === "stale"
                    ? qsTr("Calendar may be out of date. Check journalctl --user -u omarchy-calendar-sync")
                    : qsTr("Nothing scheduled")
            }

          }

          // ---- New or edited event, shown in place of the grid and the
          //      agenda like the settings page. A Loader, so every open gets
          //      a fresh form: the shell's menus drop their bindings once
          //      used, and nothing may carry over from the last event.
          Loader {
            active: root.formOpen && root.formInitial !== null
            visible: active
            width: gridColumn.width
            anchors.horizontalCenter: parent.horizontalCenter

            sourceComponent: EventForm {
              width: gridColumn.width
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              timeFormat: root.eventTimeFormat
              weekStart: root.weekStart
              calendars: root.writableCalendars
              guestSuggestions: (root.eventDoc && root.eventDoc.guestSuggestions) || []
              initialForm: root.formInitial
              errorText: root.writeError
              busy: root.writeBusy
              onSubmitted: function(form) { root.saveForm(form) }
              onCanceled: root.closeForm()
            }
          }

          // ---- Settings, shown in place of the grid. Everything it changes
          //      is owned by this panel and persisted to shell.json here, so
          //      the view stays a pure read-and-emit surface.
          SettingsView {
            visible: root.settingsOpen
            width: gridColumn.width
            anchors.horizontalCenter: parent.horizontalCenter

            foreground: root.contentForeground
            fontFamily: root.contentFontFamily

            calendars: root.knownCalendars
            hiddenCalendars: root.hiddenCalendars
            showYearProgress: root.showYearProgress
            showWorkingLocation: root.showWorkingLocation
            hideDeclined: root.hideDeclined
            weekStartsMonday: root.weekStart === 1
            announceLeadMinutes: root.setting("announceLeadMinutes", 15)

            syncState: root.syncState
            setupCommand: root.setupCommand
            setupCommandCopied: root.setupCommandCopied
            onSetupCommandCopyRequested: root.copySetupCommand()
            canWrite: root.canWrite
            onWriteSetupCopyRequested: {
              writeSetupCopier.running = true
              root.setupCommandCopied = true
              copiedReset.restart()
            }
            eventCount: root.eventDoc && root.eventDoc.events ? root.eventDoc.events.length : 0
            sourceLabel: root.eventDoc ? String(root.eventDoc.source || "") : ""
            syncedAt: root.eventDoc && root.eventDoc.syncedAt
              ? Qt.formatDateTime(new Date(root.eventDoc.syncedAt), "d MMM HH:mm")
              : ""

            onCalendarToggled: function(calendarId) { root.toggleCalendar(calendarId) }
            onYearProgressToggled: root.toggleYearProgress()
            onWorkingLocationToggled: root.toggleWorkingLocation()
            onHideDeclinedToggled: root.toggleHideDeclined()
            onWeekStartToggled: root.toggleWeekStart()
            onLeadMinutesPicked: function(minutes) { root.setAnnounceLeadMinutes(minutes) }
          }
        }
      }
    }

    // Inside KeyboardPanel, so it gets the popup's real size. Under the root
    // item it rendered at 0x0 and stayed invisible (found in #9).
    ConfirmDialog {
      anchors.fill: parent
      opened: root.pendingDelete !== null
      message: root.pendingDelete
        ? "Delete \"" + (root.pendingDelete.form.title || "(No title)") + "\"?"
        : ""
      confirmText: "Delete"
      fontFamily: root.contentFontFamily
      onConfirmed: root.pendingDelete.run()
      onCanceled: root.pendingDelete = null
    }

    // "Send invitation emails?", "This event or all events?": see ask().
    ChoiceDialog {
      anchors.fill: parent
      opened: root.choiceMessage !== ""
      message: root.choiceMessage
      firstText: root.choiceFirst
      secondText: root.choiceSecond
      fontFamily: root.contentFontFamily
      onFirst: root.answerChoice("first")
      onSecond: root.answerChoice("second")
      onCanceled: root.answerChoice(null)
    }
  }
}
