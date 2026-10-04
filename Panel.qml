import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model
import "Strings.js" as Strings

// The clock's calendar popup, in three columns: the month on the left, the
// selected day's agenda in the middle, and an inspector on the right that
// appears for one event's details or for the event form. This file owns the
// state, the events file, the settings, the keyboard and the write path; the
// columns draw what they are handed and signal back.
//
// BarWidget.qml owns the bar label and hands this panel the button to
// anchor against.
Panel {
  id: root
  moduleName: "tmn73.calendar"
  ipcTarget: "tmn73.calendar"
  manageIpc: false

  property var anchorItem: null

  // The bar tracks the widget mounted in its slot (BarWidget.qml), not this
  // nested panel. Everything the bar identifies a panel by has to be that
  // widget: the popout coordinator compares against `slot.activeItem`, and
  // switchPanelFrom looks the slot up the same way. It also owns reminders,
  // which is where snoozing goes.
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  readonly property string language: Strings.resolveLanguage(setting("language", "auto"), Qt.locale().name)
  readonly property var uiLocale: Qt.locale(Strings.localeName(language))
  // Day and month names come from uiLocale; the order they go in is the
  // language's own.
  readonly property var datePatterns: language === "pt"
    ? { hero: "d 'de' MMMM", long: "dddd, d 'de' MMMM", short: "ddd, d MMM", month: "MMMM 'de' yyyy" }
    : { hero: "MMMM d", long: "dddd, MMMM d", short: "ddd, MMM d", month: "MMMM yyyy" }

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function formatDate(date, style) {
    var text = root.uiLocale.toString(date, root.datePatterns[style])
    // Some locales abbreviate with a period ("ter.", "out."), which reads
    // as clutter in a dense list.
    return style === "short" ? text.replace(/\./g, "") : text
  }

  function formatTime(ms) {
    return Qt.formatDateTime(new Date(ms), root.eventTimeFormat)
  }

  // ---- Today. SystemClock keeps this honest across midnight so the
  //      highlight rolls over without the panel being reopened.
  property date today: new Date()
  readonly property string todayKey: Model.keyForDate(today)
  // Ticks every minute, which is what a countdown needs; `today` only moves
  // at midnight.
  property date nowTick: new Date()
  readonly property real nowMs: nowTick.getTime()

  property int viewYear: today.getFullYear()
  property int viewMonth: today.getMonth()
  readonly property date viewDate: new Date(viewYear, viewMonth, 1)

  readonly property real yearDone: Model.yearProgress(today.getFullYear(), today.getMonth(), today.getDate())
  readonly property int yearDonePercent: Model.yearProgressPercent(today.getFullYear(), today.getMonth(), today.getDate())
  readonly property int birthYear: Model.parseBirthYear(setting("birthYear", 0), today.getFullYear())
  readonly property int age: Model.ageFromBirthYear(birthYear, today.getFullYear())
  readonly property int lifeExpectancy: Model.parseLifeExpectancy(setting("lifeExpectancy", 0))
  readonly property real lifeDone: Model.lifeProgress(age, lifeExpectancy)
  readonly property int lifeDonePercent: Model.lifeProgressPercent(age, lifeExpectancy)

  // Unset falls through to the locale's own first day, so a fresh install
  // matches the rest of the desktop rather than a hardcoded convention.
  readonly property int weekStart: Model.normalizedWeekStart(setting("weekStartDay", null), Qt.locale().firstDayOfWeek)
  readonly property var weekdays: Model.weekdayOrder(weekStart)
  readonly property var weeks: Model.monthGrid(viewYear, viewMonth, weekStart, todayKey, eventIndex)
  // Short day names trimmed of the trailing period some locales carry
  // ("ter." -> "TER"), so the header row stays a clean band of caps.
  readonly property var weekdayLabels: weekdays.map(function(day) {
    return String(root.uiLocale.dayName(day, Locale.ShortFormat)).replace(/\.$/, "").toUpperCase()
  })

  // ---- Events, read from whatever wrote the state file. Google, khal, an
  //      ICS feed and a shell script all look identical from here.
  property var eventDoc: null
  property var eventIndex: ({})
  property bool eventVersionMismatch: false

  // Matches the sync timer's interval. Model.syncState allows four of these
  // to elapse before calling the file stale, so one missed run stays quiet.
  readonly property int syncIntervalSeconds: 300
  readonly property string syncState: eventVersionMismatch
    ? "version"
    : Model.syncState(eventDoc, nowMs, syncIntervalSeconds)

  // Spelled out in full because the people who need it installed from the
  // marketplace and never opened the README. Resolved from this file's own
  // location, so it is right however the plugin was installed.
  readonly property string setupCommand: Model.commandPathFromUrl(
    Qt.resolvedUrl("sync/setup"), Quickshell.env("HOME") || "")
  readonly property string writeSetupCommand: root.setupCommand + " --write"

  readonly property bool showYearProgress: setting("showYearProgress", false)
  // Google's working-location markers describe no commitment, so they are
  // out by default. Declined invitations stay in: you probably still want
  // to see what you said no to.
  readonly property bool showWorkingLocation: setting("showWorkingLocation", false)
  readonly property bool hideDeclined: setting("hideDeclined", false)
  readonly property string eventTimeFormat: String(setting("eventTimeFormat", "HH:mm") || "HH:mm")

  // Hiding happens here rather than in the sync, so toggling a calendar back
  // on is instant. Held as local state rather than read off `settings`:
  // persisting round-trips through shell.json asynchronously, so a binding
  // would still serve the old value when a second click arrives.
  property var hiddenCalendars: []
  readonly property var knownCalendars: Model.calendarsInDocument(eventDoc)
  // Events per calendar, hidden ones included, for the filter chips. By id:
  // a multi-day event is one row per day.
  readonly property var calendarCounts: {
    var seen = {}
    var counts = {}
    var events = (root.eventDoc && root.eventDoc.events) || []
    for (var i = 0; i < events.length; i++) {
      var event = events[i]
      var key = event.calendarId + "|" + event.id
      if (seen[key]) continue
      seen[key] = true
      counts[event.calendarId] = (counts[event.calendarId] || 0) + 1
    }
    return counts
  }

  // ---- Writing. The sync lists the calendars the panel may change; with no
  //      list, quick add goes to Google Calendar in the browser instead.
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
  // What to say once the running write succeeds.
  property string pendingToast: ""
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

  // ---- The selected day and event.
  property string selectedDayKey: todayKey
  readonly property bool selectedIsToday: selectedDayKey === todayKey
  readonly property var daySections: Model.daySections(
    Model.eventsForDateKey(eventIndex, selectedDayKey), nowMs, selectedIsToday)
  readonly property var dayItems: daySections.allDay.concat(daySections.timed)
  readonly property var upcomingDays: Model.upcomingDays(eventIndex, selectedDayKey, 5, 3).map(function(day) {
    var relative = Model.relativeDayLabel(day.key, root.todayKey, root.language)
    var date = root.formatDate(Model.dateFromKey(day.key, root.today), "short")
    return { key: day.key, rows: day.rows, more: day.more, label: relative !== "" ? relative + " · " + date : date }
  })
  readonly property string dayHeading: {
    var relative = Model.relativeDayLabel(root.selectedDayKey, root.todayKey, root.language)
    var date = root.formatDate(Model.dateFromKey(root.selectedDayKey, root.today), "long")
    return relative !== "" ? relative + " · " + date : date
  }

  // A row is told apart by id within its day: a multi-day event shares its
  // id across days, never within one.
  property string selectedEventId: ""
  property bool detailsOpen: false
  readonly property var selectedItem: {
    for (var i = 0; i < root.dayItems.length; i++)
      if (String(root.dayItems[i].id) === root.selectedEventId) return root.dayItems[i]
    return null
  }
  readonly property bool inspectorOpen: formOpen || (detailsOpen && selectedItem !== null)

  // Today's first timed event not yet over, shown above today's agenda.
  readonly property var nextUp: {
    if (!root.selectedIsToday) return null
    var timed = root.daySections.timed
    for (var i = 0; i < timed.length; i++)
      if (timed[i].phase !== "past" && !timed[i].done && !Model.isDeclined(timed[i])) return timed[i]
    return null
  }

  // ---- Snoozing. Reminders are sent by the bar widget, which is always
  //      loaded; for a while after one fires, the panel offers to send it
  //      again in a few minutes.
  readonly property int snoozeMinutes: 5
  readonly property var recentlyFired: hostWidget && hostWidget.recentlyFired ? hostWidget.recentlyFired : ({})
  readonly property string snoozeText: tr("notify.snooze", [snoozeMinutes])
  readonly property bool selectedSnoozable: recentlyFired !== null && canSnooze(selectedItem)
  readonly property bool nextUpSnoozable: recentlyFired !== null && canSnooze(nextUp)

  function canSnooze(event) {
    return !!event && !!root.hostWidget && typeof root.hostWidget.canSnooze === "function"
      && root.hostWidget.canSnooze(event, root.nowMs)
  }

  function snooze(event) {
    if (event && root.hostWidget && typeof root.hostWidget.snooze === "function")
      root.hostWidget.snooze(event, root.snoozeMinutes)
  }

  // ---- Quick add.
  readonly property var quickParsed: Model.parseQuickAdd(agenda.quickText, nowTick, language)
  readonly property string quickPreviewWhen: {
    var parsed = root.quickParsed
    if (!parsed) return ""
    var parts = [root.formatDate(Model.dateFromKey(parsed.dateKey, root.today), "short")]
    if (parsed.allDay) {
      parts.push(root.tr("quick.allDay"))
    } else {
      var start = Model.dateFromKey(parsed.dateKey, root.today)
      start.setHours(Number(parsed.startTime.substr(0, 2)), Number(parsed.startTime.substr(3, 2)))
      var end = new Date(start.getTime() + parsed.durationMinutes * 60000)
      parts.push(root.formatTime(start.getTime()) + "–" + root.formatTime(end.getTime())
        + " (" + Model.spanText(parsed.durationMinutes, root.language) + ")")
    }
    if (root.canWrite) parts.push(root.writableCalendars[0].name)
    if (parsed.meet) parts.push("Google Meet")
    return parts.join(" · ")
  }

  // ---- Feedback.
  property string toastText: ""
  property bool toastError: false

  function showToast(text, isError) {
    root.toastText = text
    root.toastError = isError === true
    toastTimer.restart()
  }

  function dismissToast() {
    toastTimer.stop()
    root.toastText = ""
  }

  // ---- Settings.
  property bool settingsOpen: false
  property bool setupCommandCopied: false
  // Its own flag: one "Copied" must not show on the other copy button.
  property bool writeSetupCommandCopied: false

  // Guarded so the widget renders before the bar is injected (the bar-widget
  // contract instantiates it bare).
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property int agendaWidth: Style.space(330)
  readonly property int inspectorWidth: Style.space(290)
  readonly property int columnPadding: Style.space(14)

  function applyEvents(raw) {
    var doc = null
    var mismatch = false
    if (raw) {
      try {
        var parsed = JSON.parse(raw)
        if (parsed && parsed.version === 1) doc = parsed
        // Written by a newer sync than this widget understands. Say so
        // rather than render an empty month that reads as a quiet week.
        else if (parsed && parsed.version !== undefined) mismatch = true
      } catch (error) {
        doc = null
      }
    }
    root.eventDoc = doc
    root.eventVersionMismatch = mismatch
    root.rebuildIndex()
  }

  function rebuildIndex() {
    var all = root.eventDoc ? root.eventDoc.events : []
    root.eventIndex = Model.indexEventsByDate(Model.visibleEvents(all, root.hiddenCalendars, {
      hideWorkingLocation: !root.showWorkingLocation,
      hideDeclined: root.hideDeclined
    }))
  }

  function adoptSettings() {
    var stored = setting("hiddenCalendars", [])
    root.hiddenCalendars = Array.isArray(stored) ? stored.slice() : []
  }

  // Applied locally first so the panel redraws on the click itself; the
  // shell.json write comes back through the bar as the same value. The host
  // widget builds its own entry when the label format is cycled, so it has
  // to be kept in step or it would write this key straight back out.
  function persistSettings(values) {
    var entry = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entry[existing] = root.settings[existing]
    for (var key in values) entry[key] = values[key]

    root.settings = entry
    if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  function toggleCalendar(calendarId) {
    root.hiddenCalendars = Model.toggleHiddenCalendar(root.hiddenCalendars, calendarId)
    persistSettings({ hiddenCalendars: root.hiddenCalendars })
  }

  function setWeekStart(day) {
    var next = Model.normalizedWeekStart(day, root.weekStart)
    if (next === root.weekStart) return
    persistSettings({ weekStartDay: Model.weekStartSettingName(next) })
  }

  function toggleWeekStart() {
    setWeekStart(Model.toggledWeekStart(root.weekStart))
  }

  function commitLife(bornText, spanText) {
    var born = Model.parseBirthYear(bornText, today.getFullYear())
    var span = Model.parseLifeExpectancy(spanText)
    if (born !== root.birthYear || span !== root.lifeExpectancy)
      persistSettings({ birthYear: born, lifeExpectancy: span })
  }

  // The expectancy stays in the config so setting a birth year again brings
  // your own number back rather than the default.
  function clearLife() {
    if (root.birthYear > 0) persistSettings({ birthYear: 0 })
  }

  function copySetupCommand() {
    setupCommandCopier.running = true
    root.setupCommandCopied = true
    copiedReset.restart()
  }

  function copyWriteSetupCommand() {
    writeSetupCopier.running = true
    root.writeSetupCommandCopied = true
    copiedReset.restart()
  }

  function copyLink(url) {
    var safe = Model.safeUrl(url)
    if (!safe) return
    linkCopier.command = ["wl-copy", "--", safe]
    linkCopier.running = true
    root.showToast(root.tr("toast.linkCopied"))
  }

  onHiddenCalendarsChanged: root.rebuildIndex()
  onShowWorkingLocationChanged: root.rebuildIndex()
  onHideDeclinedChanged: root.rebuildIndex()
  onSettingsChanged: root.adoptSettings()
  Component.onCompleted: root.adoptSettings()

  // ---- Opening and closing.
  function open() {
    refresh()
    root.controller.show()
    // Set after showing, not before: showing hands the popout coordinator
    // over, which closes whichever panel was open, and that close clears the
    // shared flag. Deferring means the panel taking over always wins.
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
    // Dismissing mid-edit would otherwise leave the inputs up, waiting
    // behind a closed popup for the next time it opens.
    progress.cancelEditing()
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
    root.nowTick = root.today
    root.goToToday()
  }

  function takesText(item) {
    return !!item && item !== keyFocus && "cursorPosition" in item && !item.readOnly
  }

  function focusKeys() {
    Qt.callLater(function() { keyFocus.forceActiveFocus() })
  }

  // ---- Navigation.
  function showMonthOf(key) {
    var date = Model.dateFromKey(key, root.today)
    root.viewYear = date.getFullYear()
    root.viewMonth = date.getMonth()
  }

  function goToToday() {
    root.selectDay(root.todayKey)
  }

  function moveMonth(delta) {
    var next = Model.stepMonth(viewYear, viewMonth, delta)
    root.viewYear = next.year
    root.viewMonth = next.month
  }

  function moveYear(delta) {
    moveMonth(delta * 12)
  }

  function selectDay(key) {
    root.selectedDayKey = String(key)
    root.selectedEventId = ""
    root.detailsOpen = false
    root.showMonthOf(key)
  }

  function moveSelectedDay(delta) {
    root.selectDay(Model.addDays(root.selectedDayKey, delta))
  }

  function selectEvent(item) {
    if (!item) return
    if (root.formOpen && !root.writeBusy) root.closeForm()
    if (item.dateKey !== root.selectedDayKey) root.selectDay(item.dateKey)
    root.selectedEventId = String(item.id)
    root.detailsOpen = true
  }

  // j and k: through the day's items, all-day first, wrapping at neither end.
  function stepItem(direction) {
    var items = root.dayItems
    if (items.length === 0) return
    var index = -1
    for (var i = 0; i < items.length; i++)
      if (String(items[i].id) === root.selectedEventId) index = i
    var next = index < 0 ? (direction > 0 ? 0 : items.length - 1)
      : Math.max(0, Math.min(items.length - 1, index + direction))
    root.selectedEventId = String(items[next].id)
  }

  function toggleDetails() {
    if (root.selectedItem) {
      root.detailsOpen = !root.detailsOpen
    } else if (root.dayItems.length > 0) {
      root.selectedEventId = String(root.dayItems[0].id)
      root.detailsOpen = true
    }
  }

  // Escape backs out one layer at a time; the panel closes last.
  function backOut() {
    if (root.choiceMessage !== "") root.answerChoice(null)
    // ConfirmDialog takes no keys, so Escape is how a pending delete is
    // dropped from the keyboard.
    else if (root.pendingDelete !== null) root.pendingDelete = null
    else if (root.formOpen) root.closeForm()
    else if (root.detailsOpen && root.selectedItem) root.detailsOpen = false
    else if (root.selectedEventId !== "") root.selectedEventId = ""
    else if (root.settingsOpen) root.settingsOpen = false
    else root.close()
  }

  function handleTextKey(t) {
    if (t === "[") root.moveMonth(-1)
    else if (t === "]") root.moveMonth(1)
    else if (t === "{") root.moveYear(-1)
    else if (t === "}") root.moveYear(1)
    else if (t === "t" || t === "T") root.goToToday()
    else if (t === "w" || t === "W") root.toggleWeekStart()
    else if (t === "n" || t === "N") agenda.focusQuickAdd()
    else if (t === "e" || t === "E") root.activateItem(root.selectedItem)
    else if (t === "m" || t === "M") root.joinMeeting()
    else if (t === "o" || t === "O") root.openEvent(root.selectedItem)
  }

  // ---- Acting on events.

  // Qt.openUrlExternally rather than the shell helper on purpose. That helper
  // runs `bash -lc`, and a meeting link is supplied by whoever sent the
  // invitation, so putting it through a shell would be a command injection.
  // Model.safeUrl also refuses anything that is not plain https.
  function openExternally(url) {
    var safe = Model.safeUrl(url)
    if (!safe) return
    Qt.openUrlExternally(safe)
    root.close()
  }

  function joinItem(item) {
    root.openExternally(Model.meetingUrlFor(item))
  }

  // The selected event's meeting, else the next one today with a link.
  function joinMeeting() {
    if (Model.meetingUrlFor(root.selectedItem)) return root.joinItem(root.selectedItem)
    var today = Model.daySections(Model.eventsForDateKey(root.eventIndex, root.todayKey), root.nowMs, true)
    for (var i = 0; i < today.timed.length; i++) {
      var item = today.timed[i]
      if (item.phase !== "past" && !Model.isDeclined(item) && Model.meetingUrlFor(item)) return root.joinItem(item)
    }
    root.showToast(root.tr("toast.noMeeting"))
  }

  function openEvent(item) {
    root.openExternally(Model.eventUrlFor(item))
  }

  // Tasks synced from Todoist are edited in Todoist: an edit made here would
  // be undone by the next sync.
  function isEditable(item) {
    return !!item && Model.isWritable(item, root.writableCalendars)
      && !/todoist/i.test(String(item.calendarName || ""))
  }

  // Double click and "e": edit what can be edited, open the rest in Google.
  function activateItem(item) {
    if (!item) return
    if (root.isEditable(item)) root.editEvent(item)
    else root.openEvent(item)
  }

  function submitQuickAdd(moreOptions) {
    var parsed = root.quickParsed
    if (moreOptions && root.canWrite) {
      if (parsed) root.openForm(Model.quickAddForm(parsed, root.writableCalendars[0].id))
      else root.newEvent()
      agenda.clearQuickAdd()
      return
    }
    if (!parsed) {
      if (agenda.quickText.trim() !== "") root.showToast(root.tr("quick.needsTitle"))
      return
    }
    if (!root.canWrite) {
      Qt.openUrlExternally(Model.safeUrl(Model.googleTemplateUrl(parsed)))
      root.showToast(root.tr("toast.openedInGoogle"))
      agenda.clearQuickAdd()
      return
    }
    if (root.writeBusy) return
    root.pendingToast = root.tr("toast.created", [parsed.title])
    root.runEvent({
      action: "create",
      scope: "this",
      sendUpdates: "none",
      event: Model.quickAddForm(parsed, root.writableCalendars[0].id)
    }, "save")
    agenda.clearQuickAdd()
    root.selectDay(parsed.dateKey)
    root.focusKeys()
  }

  // ---- The write path.
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
    root.focusKeys()
  }

  // Edit and delete both read the whole event first: the file carries no
  // guests or repeat rule, and a delete needs to know about both.
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
    var creating = String(form.eventId || "") === ""

    function run() {
      root.pendingToast = creating
        ? root.tr("toast.created", [form.title || root.tr("common.noTitle")])
        : root.tr("toast.saved")
      root.runEvent({
        action: creating ? "create" : "update",
        scope: choice.scope,
        sendUpdates: choice.sendUpdates,
        event: form
      }, "save")
    }

    function askInvitations() {
      if (Model.otherGuests(form).length === 0) return run()
      root.ask(root.tr("ask.sendInvites"), root.tr("ask.send"), root.tr("ask.dontSend"),
        function(answer) { choice.sendUpdates = answer === "first" ? "all" : "none"; run() })
    }

    if (askScope)
      root.ask(root.tr("ask.editRecurring"), root.tr("ask.thisEvent"), root.tr("ask.allEvents"),
        function(answer) { choice.scope = answer === "first" ? "this" : "all"; askInvitations() })
    else
      askInvitations()
  }

  function startDelete(form) {
    var choice = { scope: "this", sendUpdates: "none" }
    var series = String(form.recurringEventId || "") !== ""
    var guests = Model.otherGuests(form).length > 0

    function run() {
      root.pendingToast = root.tr("toast.deleted", [form.title || root.tr("common.noTitle")])
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
      root.ask(root.tr("ask.sendCancellations"), root.tr("ask.send"), root.tr("ask.dontSend"),
        function(answer) { choice.sendUpdates = answer === "first" ? "all" : "none"; run() })
    }

    if (series)
      root.ask(root.tr("ask.deleteRecurring"), root.tr("ask.thisEvent"), root.tr("ask.allEvents"),
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
    writeTimeout.restart()
  }

  function failWrite(message) {
    root.writeError = message
    root.pendingToast = ""
    // With the form open the error shows in it; otherwise nothing would.
    if (!root.formOpen) root.showToast(root.tr("toast.error", [message]), true)
  }

  function onWriteReply(text) {
    // Called by the stream and, as a fallback, by the exit. Only the first
    // one counts.
    if (!root.writeBusy) return
    writeTimeout.stop()
    root.writeBusy = false
    root.pendingDelete = null
    var purpose = root.pendingPurpose
    root.pendingPurpose = ""
    var reply = Model.parseWriteReply(text, root.language)
    if (!reply.ok) {
      root.failWrite(reply.error)
      return
    }
    if (purpose === "edit") {
      root.openForm(reply.event)
      return
    }
    if (purpose === "delete") {
      root.startDelete(reply.event)
      return
    }
    // A write: the command rewrote the events file, and the file watch shows
    // the change.
    if (root.pendingToast !== "") root.showToast(root.pendingToast)
    root.pendingToast = ""
    if (root.formOpen) root.closeForm()
  }

  // watchChanges is the point of this whole widget: the sync rewrites the
  // file every few minutes and the popup has to follow it. There is
  // deliberately no "already loaded" guard; one is exactly what made an
  // externally written file impossible to pick up upstream.
  FileView {
    id: eventsFile
    path: (Quickshell.env("HOME") || "") + "/.local/state/omarchy/calendar-events.json"
    watchChanges: true
    printErrors: false
    onLoaded: root.applyEvents(text())
    onLoadFailed: root.applyEvents("")
    onFileChanged: reload()
  }

  // Argv arrays rather than shell strings, so there is nothing to quote.
  Process {
    id: setupCommandCopier
    command: ["wl-copy", "--", root.setupCommand]
  }

  Process {
    id: writeSetupCopier
    command: ["wl-copy", "--", root.writeSetupCommand]
  }

  Process {
    id: linkCopier
  }

  Timer {
    id: copiedReset
    interval: 2000
    onTriggered: {
      root.setupCommandCopied = false
      root.writeSetupCommandCopied = false
    }
  }

  Timer {
    id: toastTimer
    interval: 5000
    onTriggered: root.toastText = ""
  }

  Process {
    id: writeProcess
    stdout: StdioCollector {
      id: writeOutput
      waitForEnd: true
      onStreamFinished: root.onWriteReply(text)
    }
    // If the stream never reports (the command could not start), the exit
    // still ends the wait, so the panel never stays on "Saving…". The grace
    // lets a normal reply's stream finish first, so its text is the one read.
    onExited: writeExitGrace.restart()
  }

  Timer {
    id: writeExitGrace
    interval: 500
    onTriggered: root.onWriteReply(writeOutput.text)
  }

  // A command that hangs (a keyring prompt, a dead network) must not freeze
  // writing until a shell restart. A series edit syncs inline, about 10 s,
  // so a minute is far past any normal reply.
  Timer {
    id: writeTimeout
    interval: 60000
    onTriggered: {
      if (!root.writeBusy) return
      writeProcess.running = false
      root.writeBusy = false
      root.pendingPurpose = ""
      root.pendingDelete = null
      root.failWrite(root.tr("error.timeout"))
    }
  }

  SystemClock {
    id: clock
    precision: SystemClock.Minutes
    onDateChanged: {
      root.nowTick = clock.date
      if (Model.keyForDate(clock.date) === String(root.todayKey)) return
      // Past midnight: follow the new day only if the old one was in view.
      var followToday = root.selectedDayKey === root.todayKey
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
    focusTarget: keyFocus
    contentWidth: panel.fittedContentWidth(columns.width + panel.padding * 2
      + Border.left(panel.borderSpec) + Border.right(panel.borderSpec))
    // Fixed while the panel is up, whatever the day holds: the agenda and
    // the inspector scroll inside it, so moving between days never makes
    // the popup jump.
    contentHeight: panel.fittedContentHeight(Math.max(Style.space(640), leftContent.implicitHeight + root.columnPadding))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // Off while anything that takes text has focus, so an "n" typed in a
      // title stays an "n". Escape and Enter there belong to the field. A
      // read-only text (the description, focused to copy from) takes none.
      blocked: root.takesText(Window.activeFocusItem)
      onMoveRequested: function(dx, dy) {
        if (!root.formOpen) root.moveSelectedDay(dx + dy * 7)
      }
      onActivateRequested: if (!root.formOpen) root.toggleDetails()
      onCloseRequested: root.backOut()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) { if (!root.formOpen) root.handleTextKey(t) }

      // The focus target. It sees keys before the catcher, which reads j and
      // k as arrows; here they step through the day's items instead.
      Item {
        id: keyFocus
        focus: true
        Keys.onPressed: function(event) {
          if (keyCatcher.blocked || root.formOpen) return
          if (event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier)) return
          if (event.text === "j" || event.text === "k") {
            root.stepItem(event.text === "j" ? 1 : -1)
            event.accepted = true
          }
        }
      }

      // Wider than the screen allows, the columns scroll sideways rather
      // than lose the inspector off the edge.
      Flickable {
        id: columnsScroll
        anchors.fill: parent
        contentWidth: columns.width
        contentHeight: height
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentWidth > width

        Row {
          id: columns
          height: columnsScroll.height

          // ---- Left: the month.
          Flickable {
            id: leftScroll
            width: leftContent.width + root.columnPadding
            height: parent.height
            contentWidth: width
            contentHeight: leftContent.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            Column {
              id: leftContent
              width: grid.width
              spacing: Style.space(14)

              HeroHeader {
                width: parent.width
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                language: root.language
                dateText: root.formatDate(root.today, "hero")
                sublineText: root.tr("hero.subline", [
                  root.uiLocale.dayName(root.today.getDay(), Locale.LongFormat),
                  root.formatTime(root.nowMs),
                  Model.isoWeek(root.today.getFullYear(), root.today.getMonth(), root.today.getDate())
                ])
                settingsOpen: root.settingsOpen
                canGoHome: root.selectedDayKey !== root.todayKey
                  || root.viewYear !== root.today.getFullYear() || root.viewMonth !== root.today.getMonth()
                onHomeRequested: root.goToToday()
                onSettingsToggled: root.settingsOpen = !root.settingsOpen
              }

              ProgressRails {
                id: progress
                width: parent.width
                visible: !root.settingsOpen && (root.showYearProgress || progress.editing)
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                language: root.language
                showYear: root.showYearProgress
                year: root.today.getFullYear()
                yearDone: root.yearDone
                yearDonePercent: root.yearDonePercent
                birthYear: root.birthYear
                lifeExpectancy: root.lifeExpectancy
                lifeDone: root.lifeDone
                lifeDonePercent: root.lifeDonePercent
                onLifeCommitted: function(born, span) { root.commitLife(born, span) }
                onLifeCleared: root.clearLife()
                onEditingFinished: root.focusKeys()
              }

              MonthGrid {
                id: grid
                visible: !root.settingsOpen
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                language: root.language
                weeks: root.weeks
                weekdayLabels: root.weekdayLabels
                selectedDayKey: root.selectedDayKey
                monthLabel: root.formatDate(root.viewDate, "month")
                weekStartTooltip: root.tr(Model.toggledWeekStart(root.weekStart) === 1 ? "week.startMonday" : "week.startSunday")
                onDaySelected: function(key) { root.selectDay(key) }
                onWeekStartToggled: root.toggleWeekStart()
                onMonthStepped: function(delta) { root.moveMonth(delta) }
              }

              CalendarFilters {
                width: parent.width
                visible: !root.settingsOpen && calendars.length > 0
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                language: root.language
                calendars: root.knownCalendars
                hiddenCalendars: root.hiddenCalendars
                counts: root.calendarCounts
                onToggled: function(calendarId) { root.toggleCalendar(calendarId) }
              }

              ShortcutLegend {
                width: parent.width
                visible: !root.settingsOpen
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                language: root.language
              }

              // Everything settings changes is owned by this panel and
              // persisted here, so the view stays read-and-emit.
              SettingsView {
                visible: root.settingsOpen
                width: parent.width
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                language: root.language
                languageSetting: String(root.setting("language", "auto"))
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
                canWrite: root.canWrite
                writeSetupCopied: root.writeSetupCommandCopied
                eventCount: root.eventDoc && root.eventDoc.events ? root.eventDoc.events.length : 0
                sourceLabel: root.eventDoc ? String(root.eventDoc.source || "") : ""
                syncedAt: root.eventDoc && root.eventDoc.syncedAt
                  ? root.uiLocale.toString(new Date(root.eventDoc.syncedAt), "d MMM HH:mm")
                  : ""
                onSetupCommandCopyRequested: root.copySetupCommand()
                onWriteSetupCopyRequested: root.copyWriteSetupCommand()
                onCalendarToggled: function(calendarId) { root.toggleCalendar(calendarId) }
                onYearProgressToggled: root.persistSettings({ showYearProgress: !root.showYearProgress })
                onWorkingLocationToggled: root.persistSettings({ showWorkingLocation: !root.showWorkingLocation })
                onHideDeclinedToggled: root.persistSettings({ hideDeclined: !root.hideDeclined })
                onWeekStartToggled: root.toggleWeekStart()
                onLeadMinutesPicked: function(minutes) { root.persistSettings({ announceLeadMinutes: minutes }) }
                onLanguagePicked: function(value) { root.persistSettings({ language: value }) }
              }
            }
          }

          Rectangle {
            width: Style.spacing.hairline
            height: parent.height
            color: Util.alpha(root.contentForeground, 0.1)
          }

          // ---- Middle: the agenda.
          Item {
            width: root.agendaWidth + root.columnPadding * 2
            height: parent.height

            AgendaColumn {
              id: agenda
              anchors.fill: parent
              anchors.leftMargin: root.columnPadding
              anchors.rightMargin: root.columnPadding
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              language: root.language
              timeFormat: root.eventTimeFormat
              nowMs: root.nowMs
              todayKey: root.todayKey
              isToday: root.selectedIsToday
              canWrite: root.canWrite
              busy: root.writeBusy && !root.formOpen
              dayHeading: root.dayHeading
              daySummary: Model.daySummary(root.daySections, root.language)
              sections: root.daySections
              upcoming: root.upcomingDays
              nextUp: root.nextUp
              selectedId: root.selectedEventId
              selectedSnoozable: root.selectedSnoozable
              nextUpSnoozable: root.nextUpSnoozable
              snoozeText: root.snoozeText
              syncState: root.syncState
              setupCommand: root.setupCommand
              setupCommandCopied: root.setupCommandCopied
              quickPreviewTitle: root.quickParsed ? root.quickParsed.title : ""
              quickPreviewWhen: root.quickPreviewWhen
              toastText: root.toastText
              toastError: root.toastError
              onItemSelected: function(item) { root.selectEvent(item) }
              onItemActivated: function(item) { root.selectEvent(item); root.activateItem(item) }
              onJoinRequested: function(item) { root.joinItem(item) }
              onSnoozeRequested: function(item) { root.snooze(item) }
              onDaySelected: function(key) { root.selectDay(key) }
              onQuickSubmitted: function(moreOptions) { root.submitQuickAdd(moreOptions) }
              onQuickEscaped: root.focusKeys()
              onNewEventRequested: root.newEvent()
              onSetupCopyRequested: root.copySetupCommand()
              onToastDismissed: root.dismissToast()
            }
          }

          Rectangle {
            visible: root.inspectorOpen
            width: Style.spacing.hairline
            height: parent.height
            color: Util.alpha(root.contentForeground, 0.1)
          }

          // ---- Right: the inspector.
          Flickable {
            id: inspector
            visible: root.inspectorOpen
            width: visible ? root.inspectorWidth + root.columnPadding : 0
            height: parent.height
            contentWidth: width
            contentHeight: inspectorContent.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            Column {
              id: inspectorContent
              x: root.columnPadding
              width: root.inspectorWidth

              EventDetails {
                visible: !root.formOpen && root.selectedItem !== null
                width: parent.width
                item: root.selectedItem || ({})
                whenText: root.whenText(root.selectedItem)
                nowMs: root.nowMs
                editable: root.isEditable(root.selectedItem) && !root.writeBusy
                deletable: root.isEditable(root.selectedItem) && !root.writeBusy
                snoozable: root.selectedSnoozable
                snoozeText: root.snoozeText
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                language: root.language
                onCloseRequested: root.detailsOpen = false
                onEditRequested: root.editEvent(root.selectedItem)
                onDeleteRequested: root.deleteEvent(root.selectedItem)
                onJoinRequested: root.joinItem(root.selectedItem)
                onSnoozeRequested: root.snooze(root.selectedItem)
                onLinkOpened: function(url) { root.openExternally(url) }
                onLinkCopied: function(url) { root.copyLink(url) }
              }

              // A Loader, so every open gets a fresh form: the shell's menus
              // drop their bindings once used, and nothing may carry over
              // from the last event.
              Loader {
                active: root.formOpen && root.formInitial !== null
                visible: active
                width: parent.width

                sourceComponent: EventForm {
                  width: inspectorContent.width
                  foreground: root.contentForeground
                  fontFamily: root.contentFontFamily
                  language: root.language
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
            }
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
        ? root.tr("confirm.deleteMessage", [root.pendingDelete.form.title || root.tr("common.noTitle")])
        : ""
      confirmText: root.tr("confirm.delete")
      cancelText: root.tr("common.cancel")
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
      language: root.language
      onFirst: root.answerChoice("first")
      onSecond: root.answerChoice("second")
      onCanceled: root.answerChoice(null)
    }
  }

  // "Tuesday, October 6 · 13:00–13:45 (45 min)". All-day ends are
  // exclusive, so a three-day event ends the day before its end date.
  function whenText(item) {
    if (!item) return ""
    var range = Model.timeRange(item)
    if (isNaN(range.start)) return ""
    var start = new Date(range.start)
    if (item.allDay) {
      var last = new Date(Math.max(range.start, range.end - 86400000))
      var label = root.formatDate(start, "long")
      if (Model.keyForDate(last) !== Model.keyForDate(start)) label += " – " + root.formatDate(last, "long")
      return label + " · " + root.tr("insp.allDay")
    }
    var end = new Date(range.end)
    var minutes = Math.round((range.end - range.start) / 60000)
    if (Model.keyForDate(end) !== Model.keyForDate(start))
      return root.formatDate(start, "long") + " " + root.formatTime(range.start)
        + " – " + root.formatDate(end, "long") + " " + root.formatTime(range.end)
    return root.formatDate(start, "long") + " · " + root.formatTime(range.start) + "–" + root.formatTime(range.end)
      + " (" + Model.spanText(minutes, root.language) + ")"
  }
}
