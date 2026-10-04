.pragma library

// Every user-visible string, in English and Brazilian Portuguese.
//
// Keys are "area.item" in lowerCamelCase. Two suffix conventions:
//   ".one" / ".other"  plural forms, picked by trn() from a count
//   ".m" / ".f"        grammatical gender, picked by trFor(); Portuguese
//                      needs it where a weekday follows ("no sábado", "na
//                      sexta-feira"), English never does
// Headings are stored in sentence case; the UI upper-cases them, so the
// same key reads right in a heading and in a tooltip.
//
// A key missing from "pt" falls back to "en", and a key missing from both
// comes back as itself, which keeps a typo visible instead of blank.

var DEFAULT_LANGUAGE = "en"
var LANGUAGES = ["en", "pt"]

// Each language is named in itself, whatever the current one, so it can be
// found by someone who cannot read the current one.
var LANGUAGE_NAMES = { en: "English", pt: "Português (Brasil)" }

var STRINGS = {
  en: {
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.noTitle": "(No title)",

    "weekday.0": "Sunday",
    "weekday.1": "Monday",
    "weekday.2": "Tuesday",
    "weekday.3": "Wednesday",
    "weekday.4": "Thursday",
    "weekday.5": "Friday",
    "weekday.6": "Saturday",
    "month.0": "January",
    "month.1": "February",
    "month.2": "March",
    "month.3": "April",
    "month.4": "May",
    "month.5": "June",
    "month.6": "July",
    "month.7": "August",
    "month.8": "September",
    "month.9": "October",
    "month.10": "November",
    "month.11": "December",

    "unit.min": "%1 min",
    "unit.h": "%1 h",
    "unit.hmin": "%1 h %2 min",

    "rel.now": "now",
    "rel.in": "in %1",
    "rel.left.one": "now · %1 left",
    "rel.left.other": "now · %1 left",
    "rel.endedAgo": "ended %1 ago",
    "rel.today": "today",
    "rel.tomorrow": "tomorrow",
    "rel.yesterday": "yesterday",
    "rel.inDays.one": "in %1 day",
    "rel.inDays.other": "in %1 days",
    "rel.daysAgo.one": "%1 day ago",
    "rel.daysAgo.other": "%1 days ago",
    "rel.long.startsIn": "starts in %1",
    "rel.long.startingNow": "starting now",
    "rel.long.live": "happening now",
    "rel.long.left.one": "happening now · %1 left",
    "rel.long.left.other": "happening now · %1 left",
    "rel.long.inDays.one": "in %1 day",
    "rel.long.inDays.other": "in %1 days",

    "day.today": "Today",
    "day.tomorrow": "Tomorrow",
    "day.yesterday": "Yesterday",
    "hero.subline": "%1 · %2 · week %3",
    "grid.week": "W",

    "summary.meetings.one": "%1 meeting",
    "summary.meetings.other": "%1 meetings",
    "summary.events.one": "%1 event",
    "summary.events.other": "%1 events",
    "summary.deadlines.one": "%1 deadline",
    "summary.deadlines.other": "%1 deadlines",
    "summary.tasks.one": "%1 task",
    "summary.tasks.other": "%1 tasks",
    "summary.done.one": "%1 done",
    "summary.done.other": "%1 done",
    "summary.empty": "Nothing scheduled",

    "kind.event": "Event",
    "kind.task": "Task",
    "kind.deadline": "Deadline",

    "nav.previousMonth": "Previous month",
    "nav.nextMonth": "Next month",
    "nav.backToToday": "Back to today",
    "nav.settings": "Settings",
    "nav.backToCalendar": "Back to calendar",
    "nav.newEvent": "New event (N)",
    "week.startSunday": "Start weeks on Sunday",
    "week.startMonday": "Start weeks on Monday",

    "chips.title": "Calendars",
    "chips.toggle": "Show or hide %1",

    "keys.title": "Shortcuts",
    "keys.new": "new",
    "keys.navigate": "navigate",
    "keys.details": "details",
    "keys.edit": "edit",
    "keys.join": "join meeting",
    "keys.open": "open in Google",
    "keys.days": "days",
    "keys.weeks": "weeks",
    "keys.month": "month",
    "keys.year": "year",
    "keys.today": "today",
    "keys.back": "back",

    "quick.label": "Quick add",
    "quick.placeholder": "New… e.g. call with Ana tomorrow 2pm for 45m",
    "quick.moreOptions": "More options",
    "quick.create": "Create",
    "quick.allDay": "all day",
    "quick.needsTitle": "Type a title first",

    "next.badge": "Next · in %1",
    "next.live": "Happening now",

    "agenda.title": "Agenda",
    "agenda.loading": "Loading…",
    "agenda.allDay": "All day",
    "agenda.timed": "Scheduled",
    "agenda.upcoming": "Upcoming days",
    "agenda.deadlineBadge": "Deadline",
    "agenda.join": "Join",
    "agenda.joinHost": "Join %1",
    "agenda.openHost": "Open %1",
    "agenda.declined": "Declined",
    "agenda.outOfOffice": "Out of office",
    "agenda.completeTask": "Complete task",
    "agenda.reopenTask": "Reopen task",
    "agenda.empty": "Nothing on this day. Type above or double-click here to create.",
    "agenda.emptyReadOnly": "Nothing on this day.",
    "agenda.more.one": "+%1 more",
    "agenda.more.other": "+%1 more",
    "agenda.rowDeadline": "deadline",
    "agenda.rowTask": "task",
    "agenda.rowAllDay": "all day",

    "toast.created": "Created: %1",
    "toast.saved": "Changes saved",
    "toast.deleted": "Deleted: %1",
    "toast.openedInGoogle": "Opened in Google Calendar to finish",
    "toast.linkCopied": "Link copied",
    "toast.error": "Something went wrong: %1",
    "toast.noMeeting": "No meeting to join",
    "toast.undo": "Undo",
    "toast.dismiss": "Dismiss",

    "insp.label": "Event details",
    "insp.close": "Close details",
    "insp.allDay": "all day",
    "insp.join": "Join %1",
    "insp.joinMeeting": "Join meeting",
    "insp.copyLink": "Copy link",
    "insp.directions": "Directions ↗",
    "insp.location": "Location",
    "insp.description": "Description",
    "insp.reminders": "Reminder: %1",
    "insp.noReminder": "No reminder",
    "insp.edit": "Edit",
    "insp.duplicate": "Duplicate",
    "insp.openInGoogle": "Open in Google Calendar",
    "insp.delete": "Delete",
    "insp.openInTodoist": "Open in Todoist ↗",
    "insp.todoistNote": "Task synced from Todoist. Edits made here would be undone by the next sync, so editing opens Todoist.",
    "insp.readOnlyNote": "This calendar is read-only here. Edit it in Google Calendar.",

    "bar.soon": "%1 in %2",
    "bar.live": "Now: %1",
    "bar.join": "Join",
    "bar.more": "+%1",
    "bar.tooltip": "Click: open the panel · Middle click: join the next meeting · Right click: change the format",

    "notify.app": "Calendar",
    "notify.title": "%1 in %2",
    "notify.titleNow": "%1 is starting",
    "notify.join": "Join",
    "notify.open": "Open",
    "notify.snooze": "Snooze %1 min",

    "form.newEvent": "New event",
    "form.editEvent": "Edit event",
    "form.titlePlaceholder": "Add title",
    "form.seriesNote": "Part of a series. You choose this event or all events when you save.",
    "form.starts": "Starts",
    "form.ends": "Ends",
    "form.allDay": "All day",
    "form.repeat": "Repeat",
    "form.meet": "Meet",
    "form.meetOnSave": "A Google Meet link is added on save",
    "form.meetAdd": "Add Google Meet video conferencing",
    "form.locationPlaceholder": "Add location",
    "form.descriptionPlaceholder": "Add description",
    "form.calendar": "Calendar",
    "form.saving": "Saving…",
    "form.save": "Save",
    "form.create": "Create",

    "options.more": "More options",
    "options.notification": "Notification",
    "options.showAs": "Show as",
    "options.busy": "Busy",
    "options.free": "Free",
    "options.visibility": "Visibility",
    "options.visibilityDefault": "Default visibility",
    "options.public": "Public",
    "options.private": "Private",
    "options.colour": "Colour",
    "options.guestsCanModify": "Guests can modify the event",
    "options.guestsCanInviteOthers": "Guests can invite others",
    "options.guestsCanSeeOtherGuests": "Guests can see the guest list",

    "reminder.default": "Default",
    "reminder.none": "None",
    "reminder.custom": "Custom (kept as it is)",
    "reminder.atStart": "At start time",
    "reminder.minutes.one": "%1 minute before",
    "reminder.minutes.other": "%1 minutes before",
    "reminder.hours.one": "%1 hour before",
    "reminder.hours.other": "%1 hours before",
    "reminder.days.one": "%1 day before",
    "reminder.days.other": "%1 days before",
    "reminder.weeks.one": "%1 week before",
    "reminder.weeks.other": "%1 weeks before",

    "repeat.none": "Does not repeat",
    "repeat.daily": "Daily",
    "repeat.weekly": "Weekly on %1",
    "repeat.monthly": "Monthly on the %1 %2",
    "repeat.yearly": "Annually on %2 %1",
    "repeat.weekdays": "Every weekday (Monday to Friday)",
    "repeat.custom": "Custom rule (kept as it is)",
    "ordinal.1": "first",
    "ordinal.2": "second",
    "ordinal.3": "third",
    "ordinal.4": "fourth",
    "ordinal.-1": "last",

    "guests.placeholder": "Add guests",
    "guests.organizer": "(organizer)",
    "guests.remove": "Remove",
    "guests.going": "Going",
    "guests.maybe": "Maybe",
    "guests.declined": "Declined",
    "guests.awaiting": "Awaiting",

    "ask.sendInvites": "Send invitation emails to the guests?",
    "ask.sendCancellations": "Send cancellation emails to the guests?",
    "ask.send": "Send",
    "ask.dontSend": "Don't send",
    "ask.editRecurring": "Edit a recurring event",
    "ask.deleteRecurring": "Delete a recurring event",
    "ask.thisEvent": "This event",
    "ask.allEvents": "All events",
    "confirm.deleteMessage": "Delete \"%1\"?",
    "confirm.delete": "Delete",

    "error.timeout": "The event command did not answer within a minute.",
    "error.commandFailed": "The event command failed: %1",
    "error.noOutput": "no output",

    "sync.copied": "Copied. Paste it in a terminal:\n%1\n\nTo skip Google Cloud (read only), add --ics",
    "sync.missingPanel": "No calendar synced yet. Click to copy, then run:\n%1\n\nTo skip Google Cloud (read only), add --ics",
    "sync.versionPanel": "Events file was written by a newer version. Update the plugin.",
    "sync.stalePanel": "Calendar may be out of date. Check journalctl --user -u omarchy-calendar-sync",

    "life.born": "Born",
    "life.yearPlaceholder": "year",
    "life.liveTo": "Live to",
    "life.title": "Life",
    "life.mementoMori": "Memento Mori",

    "settings.calendars": "Calendars",
    "settings.noCalendars": "Nothing synced yet, so there is nothing to choose from.",
    "settings.display": "Display",
    "settings.weekMonday": "Week starts on Monday",
    "settings.weekMondayHint": "Off starts the week on Sunday",
    "settings.workingLocation": "Working location events",
    "settings.workingLocationHint": "Google's work-from-home markers, hidden by default",
    "settings.declined": "Declined invitations",
    "settings.declinedHint": "Shown struck through when on",
    "settings.write": "Create and edit events",
    "settings.writeOn": "On",
    "settings.writeCopied": "Copied. Paste it in a terminal",
    "settings.writeOff": "Off. Click to copy the command that turns it on",
    "settings.progress": "Year and life progress",
    "settings.progressHint": "The upstream clock's bars, off by default",
    "settings.language": "Language",
    "settings.languageHint": "Auto follows the system language",
    "settings.reminders": "Reminders",
    "settings.remindersHint": "Desktop notifications at each event's reminder time, or 10 min before a meeting that has none",
    "settings.barLabel": "Bar label",
    "settings.barLabelHint": "How early the bar gives up the clock to announce what is next.",
    "settings.never": "Never",
    "settings.minutes": "%1 min",
    "settings.sync": "Sync",
    "settings.syncMissing": "No calendar connected yet. Click to copy, then run:\n%1\n\nTo skip Google Cloud (read only), add --ics",
    "settings.syncVersion": "The events file was written by a newer version of this plugin.",
    "settings.syncEvents.one": "%1 event from %2",
    "settings.syncEvents.other": "%1 events from %2",
    "settings.syncStale": "Last sync looks old. Check: journalctl --user -u omarchy-calendar-sync",
    "settings.syncLast": "Last sync %1",

    "language.auto": "Automatic"
  },

  pt: {
    "common.cancel": "Cancelar",
    "common.close": "Fechar",
    "common.noTitle": "(Sem título)",

    "weekday.0": "domingo",
    "weekday.1": "segunda-feira",
    "weekday.2": "terça-feira",
    "weekday.3": "quarta-feira",
    "weekday.4": "quinta-feira",
    "weekday.5": "sexta-feira",
    "weekday.6": "sábado",
    "weekday.gender.0": "m",
    "weekday.gender.1": "f",
    "weekday.gender.2": "f",
    "weekday.gender.3": "f",
    "weekday.gender.4": "f",
    "weekday.gender.5": "f",
    "weekday.gender.6": "m",
    "month.0": "janeiro",
    "month.1": "fevereiro",
    "month.2": "março",
    "month.3": "abril",
    "month.4": "maio",
    "month.5": "junho",
    "month.6": "julho",
    "month.7": "agosto",
    "month.8": "setembro",
    "month.9": "outubro",
    "month.10": "novembro",
    "month.11": "dezembro",

    "rel.now": "agora",
    "rel.in": "em %1",
    "rel.left.one": "agora · falta %1",
    "rel.left.other": "agora · faltam %1",
    "rel.endedAgo": "terminou há %1",
    "rel.today": "hoje",
    "rel.tomorrow": "amanhã",
    "rel.yesterday": "ontem",
    "rel.inDays.one": "em %1 dia",
    "rel.inDays.other": "em %1 dias",
    "rel.daysAgo.one": "há %1 dia",
    "rel.daysAgo.other": "há %1 dias",
    "rel.long.startsIn": "começa em %1",
    "rel.long.startingNow": "começando agora",
    "rel.long.live": "acontecendo agora",
    "rel.long.left.one": "acontecendo agora · falta %1",
    "rel.long.left.other": "acontecendo agora · faltam %1",
    "rel.long.inDays.one": "daqui a %1 dia",
    "rel.long.inDays.other": "daqui a %1 dias",

    "day.today": "Hoje",
    "day.tomorrow": "Amanhã",
    "day.yesterday": "Ontem",
    "hero.subline": "%1 · %2 · semana %3",

    "summary.meetings.one": "%1 compromisso",
    "summary.meetings.other": "%1 compromissos",
    "summary.events.one": "%1 evento",
    "summary.events.other": "%1 eventos",
    "summary.deadlines.one": "%1 prazo",
    "summary.deadlines.other": "%1 prazos",
    "summary.tasks.one": "%1 tarefa",
    "summary.tasks.other": "%1 tarefas",
    "summary.done.one": "%1 concluída",
    "summary.done.other": "%1 concluídas",
    "summary.empty": "Nada agendado",

    "kind.event": "Evento",
    "kind.task": "Tarefa",
    "kind.deadline": "Prazo",

    "nav.previousMonth": "Mês anterior",
    "nav.nextMonth": "Próximo mês",
    "nav.backToToday": "Voltar para hoje",
    "nav.settings": "Configurações",
    "nav.backToCalendar": "Voltar ao calendário",
    "nav.newEvent": "Novo evento (N)",
    "week.startSunday": "Começar a semana no domingo",
    "week.startMonday": "Começar a semana na segunda-feira",

    "chips.title": "Agendas",
    "chips.toggle": "Mostrar ou ocultar %1",

    "keys.title": "Atalhos",
    "keys.new": "novo",
    "keys.navigate": "navegar",
    "keys.details": "detalhes",
    "keys.edit": "editar",
    "keys.join": "entrar na reunião",
    "keys.open": "abrir no Google",
    "keys.days": "dias",
    "keys.weeks": "semanas",
    "keys.month": "mês",
    "keys.year": "ano",
    "keys.today": "hoje",
    "keys.back": "voltar",

    "quick.label": "Criar evento rápido",
    "quick.placeholder": "Novo… ex.: call com Ana amanhã 14h por 45min",
    "quick.moreOptions": "Mais opções",
    "quick.create": "Criar",
    "quick.allDay": "dia todo",
    "quick.needsTitle": "Digite um título primeiro",

    "next.badge": "Próximo · em %1",
    "next.live": "Acontecendo agora",

    "agenda.title": "Agenda",
    "agenda.loading": "Carregando…",
    "agenda.allDay": "Dia todo",
    "agenda.timed": "Com horário",
    "agenda.upcoming": "Próximos dias",
    "agenda.deadlineBadge": "Prazo",
    "agenda.join": "Entrar",
    "agenda.joinHost": "Entrar no %1",
    "agenda.openHost": "Abrir %1",
    "agenda.declined": "Recusado",
    "agenda.outOfOffice": "Fora do escritório",
    "agenda.completeTask": "Concluir tarefa",
    "agenda.reopenTask": "Reabrir tarefa",
    "agenda.empty": "Nada neste dia. Digite no campo acima ou dê dois cliques aqui para criar.",
    "agenda.emptyReadOnly": "Nada neste dia.",
    "agenda.more.one": "+%1 item",
    "agenda.more.other": "+%1 itens",
    "agenda.rowDeadline": "prazo",
    "agenda.rowTask": "tarefa",
    "agenda.rowAllDay": "dia todo",

    "toast.created": "Criado: %1",
    "toast.saved": "Alterações salvas",
    "toast.deleted": "Excluído: %1",
    "toast.openedInGoogle": "Aberto no Google Agenda para concluir",
    "toast.linkCopied": "Link copiado",
    "toast.error": "Algo deu errado: %1",
    "toast.noMeeting": "Nenhuma reunião para entrar",
    "toast.undo": "Desfazer",
    "toast.dismiss": "Dispensar",

    "insp.label": "Detalhes do evento",
    "insp.close": "Fechar detalhes",
    "insp.allDay": "dia todo",
    "insp.join": "Entrar no %1",
    "insp.joinMeeting": "Entrar na reunião",
    "insp.copyLink": "Copiar link",
    "insp.directions": "Rotas ↗",
    "insp.location": "Local",
    "insp.description": "Descrição",
    "insp.reminders": "Notificação: %1",
    "insp.noReminder": "Sem notificação",
    "insp.edit": "Editar",
    "insp.duplicate": "Duplicar",
    "insp.openInGoogle": "Abrir no Google Agenda",
    "insp.delete": "Excluir",
    "insp.openInTodoist": "Abrir no Todoist ↗",
    "insp.todoistNote": "Tarefa sincronizada pelo Todoist. Editar aqui seria desfeito pela próxima sincronização, então a edição abre no Todoist.",
    "insp.readOnlyNote": "Esta agenda é somente leitura aqui. Edite no Google Agenda.",

    "bar.soon": "%1 em %2",
    "bar.live": "Agora: %1",
    "bar.join": "Entrar",
    "bar.tooltip": "Clique: abre o painel · Clique do meio: entra na próxima reunião · Clique direito: alterna o formato",

    "notify.app": "Calendário",
    "notify.title": "%1 em %2",
    "notify.titleNow": "%1 está começando",
    "notify.join": "Entrar",
    "notify.open": "Abrir",
    "notify.snooze": "Adiar %1 min",

    "form.newEvent": "Novo evento",
    "form.editEvent": "Editar evento",
    "form.titlePlaceholder": "Adicionar título",
    "form.seriesNote": "Faz parte de uma série. Ao salvar, você escolhe entre este evento e todos os eventos.",
    "form.starts": "Início",
    "form.ends": "Fim",
    "form.allDay": "Dia todo",
    "form.repeat": "Repetir",
    "form.meetOnSave": "O link do Google Meet é criado ao salvar",
    "form.meetAdd": "Adicionar videoconferência do Google Meet",
    "form.locationPlaceholder": "Adicionar local",
    "form.descriptionPlaceholder": "Adicionar descrição",
    "form.calendar": "Agenda",
    "form.saving": "Salvando…",
    "form.save": "Salvar",
    "form.create": "Criar",

    "options.more": "Mais opções",
    "options.notification": "Notificação",
    "options.showAs": "Mostrar como",
    "options.busy": "Ocupado",
    "options.free": "Disponível",
    "options.visibility": "Visibilidade",
    "options.visibilityDefault": "Visibilidade padrão",
    "options.public": "Público",
    "options.private": "Particular",
    "options.colour": "Cor",
    "options.guestsCanModify": "Convidados podem modificar o evento",
    "options.guestsCanInviteOthers": "Convidados podem convidar outras pessoas",
    "options.guestsCanSeeOtherGuests": "Convidados podem ver a lista de convidados",

    "reminder.default": "Padrão",
    "reminder.none": "Nenhuma",
    "reminder.custom": "Personalizada (mantida como está)",
    "reminder.atStart": "Na hora do evento",
    "reminder.minutes.one": "%1 minuto antes",
    "reminder.minutes.other": "%1 minutos antes",
    "reminder.hours.one": "%1 hora antes",
    "reminder.hours.other": "%1 horas antes",
    "reminder.days.one": "%1 dia antes",
    "reminder.days.other": "%1 dias antes",
    "reminder.weeks.one": "%1 semana antes",
    "reminder.weeks.other": "%1 semanas antes",

    "repeat.none": "Não se repete",
    "repeat.daily": "Todos os dias",
    "repeat.weekly.m": "Toda semana no %1",
    "repeat.weekly.f": "Toda semana na %1",
    "repeat.monthly.m": "Todo mês no %1 %2",
    "repeat.monthly.f": "Todo mês na %1 %2",
    "repeat.yearly": "Todo ano em %1 de %2",
    "repeat.weekdays": "Dias úteis (segunda a sexta)",
    "repeat.custom": "Regra personalizada (mantida como está)",
    "ordinal.1.m": "primeiro",
    "ordinal.2.m": "segundo",
    "ordinal.3.m": "terceiro",
    "ordinal.4.m": "quarto",
    "ordinal.-1.m": "último",
    "ordinal.1.f": "primeira",
    "ordinal.2.f": "segunda",
    "ordinal.3.f": "terceira",
    "ordinal.4.f": "quarta",
    "ordinal.-1.f": "última",

    "guests.placeholder": "Adicionar convidados",
    "guests.organizer": "(organizador)",
    "guests.remove": "Remover",
    "guests.going": "Confirmou",
    "guests.maybe": "Talvez",
    "guests.declined": "Recusou",
    "guests.awaiting": "Aguardando resposta",

    "ask.sendInvites": "Enviar convites por e-mail aos convidados?",
    "ask.sendCancellations": "Avisar os convidados do cancelamento por e-mail?",
    "ask.send": "Enviar",
    "ask.dontSend": "Não enviar",
    "ask.editRecurring": "Editar evento recorrente",
    "ask.deleteRecurring": "Excluir evento recorrente",
    "ask.thisEvent": "Este evento",
    "ask.allEvents": "Todos os eventos",
    "confirm.deleteMessage": "Excluir \"%1\"?",
    "confirm.delete": "Excluir",

    "error.timeout": "O comando de eventos não respondeu em um minuto.",
    "error.commandFailed": "O comando de eventos falhou: %1",
    "error.noOutput": "sem saída",

    "sync.copied": "Copiado. Cole em um terminal:\n%1\n\nPara dispensar o Google Cloud (só leitura), adicione --ics",
    "sync.missingPanel": "Nenhuma agenda sincronizada ainda. Clique para copiar e depois execute:\n%1\n\nPara dispensar o Google Cloud (só leitura), adicione --ics",
    "sync.versionPanel": "O arquivo de eventos foi gravado por uma versão mais nova. Atualize o plugin.",
    "sync.stalePanel": "A agenda pode estar desatualizada. Verifique journalctl --user -u omarchy-calendar-sync",

    "life.born": "Nascimento",
    "life.yearPlaceholder": "ano",
    "life.liveTo": "Viver até",
    "life.title": "Vida",

    "settings.calendars": "Agendas",
    "settings.noCalendars": "Nada sincronizado ainda, então não há o que escolher.",
    "settings.display": "Exibição",
    "settings.weekMonday": "Semana começa na segunda-feira",
    "settings.weekMondayHint": "Desativado, a semana começa no domingo",
    "settings.workingLocation": "Eventos de local de trabalho",
    "settings.workingLocationHint": "Marcações de trabalho remoto do Google, ocultas por padrão",
    "settings.declined": "Convites recusados",
    "settings.declinedHint": "Aparecem riscados quando ativado",
    "settings.write": "Criar e editar eventos",
    "settings.writeOn": "Ativado",
    "settings.writeCopied": "Copiado. Cole em um terminal",
    "settings.writeOff": "Desativado. Clique para copiar o comando que ativa",
    "settings.progress": "Progresso do ano e da vida",
    "settings.progressHint": "As barras do relógio original, desativadas por padrão",
    "settings.language": "Idioma",
    "settings.languageHint": "Automático segue o idioma do sistema",
    "settings.reminders": "Notificações",
    "settings.remindersHint": "Avisos na área de trabalho no horário da notificação de cada evento, ou 10 min antes de reuniões sem notificação",
    "settings.barLabel": "Texto da barra",
    "settings.barLabelHint": "Com quanta antecedência a barra troca o relógio pelo próximo compromisso.",
    "settings.never": "Nunca",
    "settings.sync": "Sincronização",
    "settings.syncMissing": "Nenhuma agenda conectada ainda. Clique para copiar e depois execute:\n%1\n\nPara dispensar o Google Cloud (só leitura), adicione --ics",
    "settings.syncVersion": "O arquivo de eventos foi gravado por uma versão mais nova deste plugin.",
    "settings.syncEvents.one": "%1 evento de %2",
    "settings.syncEvents.other": "%1 eventos de %2",
    "settings.syncStale": "A última sincronização parece antiga. Verifique: journalctl --user -u omarchy-calendar-sync",
    "settings.syncLast": "Última sincronização: %1",

    "language.auto": "Automático"
  }
}

function normalizedLanguage(lang) {
  return STRINGS.hasOwnProperty(lang) ? lang : DEFAULT_LANGUAGE
}

function lookup(lang, key) {
  var table = STRINGS[normalizedLanguage(lang)]
  if (table.hasOwnProperty(key)) return table[key]
  if (STRINGS[DEFAULT_LANGUAGE].hasOwnProperty(key)) return STRINGS[DEFAULT_LANGUAGE][key]
  return null
}

// `args` is an array for %1, %2…, or a single value for %1. A placeholder
// with no argument is left in place rather than printed as "undefined".
function format(text, args) {
  var list = args === undefined || args === null ? [] : (Array.isArray(args) ? args : [args])
  return String(text).replace(/%(\d)/g, function(match, digit) {
    var value = list[Number(digit) - 1]
    return value === undefined || value === null ? match : String(value)
  })
}

function tr(lang, key, args) {
  var text = lookup(lang, key)
  return format(text === null ? key : text, args)
}

// Plurals: "key.one" for exactly 1, "key.other" otherwise (0 included, as
// both languages say "0 tasks" / "0 tarefas"). The count is %1 unless
// `args` says otherwise.
function trn(lang, key, count, args) {
  return tr(lang, key + (Number(count) === 1 ? ".one" : ".other"), args === undefined ? [count] : args)
}

// The `variant` form of a key ("key.m", "key.f") when the language has one,
// else the plain key. English defines only plain keys, Portuguese only the
// variants it needs.
function trFor(lang, key, variant, args) {
  var table = STRINGS[normalizedLanguage(lang)]
  var specific = key + "." + variant
  return variant && table.hasOwnProperty(specific) ? format(table[specific], args) : tr(lang, key, args)
}

// "m", "f", or "" for a language without grammatical gender.
function weekdayGender(lang, weekday) {
  var table = STRINGS[normalizedLanguage(lang)]
  var key = "weekday.gender." + weekday
  return table.hasOwnProperty(key) ? table[key] : ""
}

// The `language` setting ("auto", "en", "pt") resolved against the system
// locale name (Qt.locale().name, e.g. "pt_BR").
function resolveLanguage(setting, systemLocale) {
  var chosen = String(setting === undefined || setting === null ? "" : setting).toLowerCase()
  for (var i = 0; i < LANGUAGES.length; i++)
    if (chosen.indexOf(LANGUAGES[i]) === 0) return LANGUAGES[i]
  var system = String(systemLocale || "").toLowerCase()
  return system.indexOf("pt") === 0 ? "pt" : DEFAULT_LANGUAGE
}

// For Qt.locale(), so day and month names match the strings around them.
function localeName(lang) {
  return normalizedLanguage(lang) === "pt" ? "pt_BR" : "en_US"
}

// The language setting's menu.
function languageOptions(lang) {
  var options = [{ value: "auto", label: tr(lang, "language.auto") }]
  for (var i = 0; i < LANGUAGES.length; i++)
    options.push({ value: LANGUAGES[i], label: LANGUAGE_NAMES[LANGUAGES[i]] })
  return options
}
