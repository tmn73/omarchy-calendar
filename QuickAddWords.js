.pragma library

// The words quick add reads, in English and Portuguese. Every word is
// written folded (lower case, no accents), the way QuickAddParser.js
// matches them. A new language is mostly new rows here.

var WEEKDAYS = [
  ["sunday", "sun", "domingo", "dom"],
  ["monday", "mon", "segunda", "seg"],
  ["tuesday", "tues", "tue", "terca", "ter"],
  ["wednesday", "wed", "quarta", "qua"],
  ["thursday", "thurs", "thur", "thu", "quinta", "qui"],
  ["friday", "fri", "sexta", "sex"],
  ["saturday", "sat", "sabado", "sab"]
]

// Short forms that are also ordinary words ("Ter aula com Ana", "sun lamp",
// "Dom Casmurro") are only a weekday with something that says so: a word
// that introduces a day before them ("na ter", "next sat", "até sex"), or
// a time right after ("sex 15h", "sun at 5pm"). Full names always count.
var AMBIGUOUS_WEEKDAYS = ["sun", "sat", "wed", "dom", "ter", "sex"]

// Portuguese abbreviations that are also English words ("set", "out") only
// count after "de" ("12 de out"), and only English is ever written month
// first ("Oct 12").
var MONTHS = [
  ["january", "janeiro"], ["february", "fevereiro"], ["march", "marco"], ["april", "abril"],
  ["may", "maio"], ["june", "junho"], ["july", "julho"], ["august", "agosto"],
  ["september", "setembro"], ["october", "outubro"], ["november", "novembro"], ["december", "dezembro"]
]
var MONTHS_EN_SHORT = [["jan"], ["feb"], ["mar"], ["apr"], [], ["jun"], ["jul"], ["aug"],
  ["sept", "sep"], ["oct"], ["nov"], ["dec"]]
var MONTHS_PT_SHORT = [["jan"], ["fev"], ["mar"], ["abr"], ["mai"], ["jun"], ["jul"], ["ago"],
  ["set"], ["out"], ["nov"], ["dez"]]

var FOLDED_LETTERS = {
  "á": "a", "à": "a", "â": "a", "ã": "a", "ä": "a", "é": "e", "è": "e", "ê": "e", "ë": "e",
  "í": "i", "ì": "i", "î": "i", "ï": "i", "ó": "o", "ò": "o", "ô": "o", "õ": "o", "ö": "o",
  "ú": "u", "ù": "u", "û": "u", "ü": "u", "ç": "c"
}

// Numbers written out, for "in two hours" and "por duas horas". A ten
// takes a digit after it: "twenty-five", "twenty five", "vinte e cinco".
var EN_DIGITS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
var PT_DIGITS = ["um", "uma", "dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove"]
var TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "dez", "onze", "doze", "treze", "quatorze", "catorze", "quinze",
  "dezesseis", "dezasseis", "dezessete", "dezassete", "dezoito", "dezenove", "dezanove"]
var EN_TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
var PT_TENS = ["vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
var NUMBER_WORDS = {
  "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
  "eight": 8, "nine": 9,
  "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6,
  "sete": 7, "oito": 8, "nove": 9,
  "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
  "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
  "dez": 10, "onze": 11, "doze": 12, "treze": 13, "quatorze": 14, "catorze": 14, "quinze": 15,
  "dezesseis": 16, "dezasseis": 16, "dezessete": 17, "dezassete": 17, "dezoito": 18,
  "dezenove": 19, "dezanove": 19,
  "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
  "eighty": 80, "ninety": 90,
  "vinte": 20, "trinta": 30, "quarenta": 40, "cinquenta": 50, "sessenta": 60, "setenta": 70,
  "oitenta": 80, "noventa": 90
}

// An hour written out, only after "at" or "às": "at three", "às duas".
var EN_HOURS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve"]
var PT_HOURS = ["uma", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
  "onze", "doze"]

var MINUTE_UNITS = ["minutes", "minute", "minutos", "minuto", "mins", "min", "m"]
var HOUR_UNITS = ["hours", "hour", "horas", "hora", "hrs", "hr", "h"]
var DAY_UNITS = ["days", "day", "dias", "dia", "d"]
var WEEK_UNITS = ["weeks", "week", "semanas", "semana", "wks", "wk", "w"]
var MONTH_UNITS = ["months", "month", "meses", "mes"]

// Where a day part starts, in minutes after midnight. A phrase in
// DAY_PART_PHRASES always counts; a bare word only right after a day
// ("friday morning"), so "Morning run" keeps its title.
var DAY_PART_START = { morning: 9 * 60, afternoon: 14 * 60, evening: 19 * 60 }
var DAY_PART_PHRASES = {
  morning: ["this morning", "in the morning", "de manha", "pela manha", "na manha"],
  afternoon: ["this afternoon", "in the afternoon", "a tarde", "de tarde", "pela tarde", "na tarde"],
  evening: ["this evening", "in the evening", "tonight", "tonite", "at night", "a noite", "de noite",
    "pela noite", "na noite", "esta noite", "nesta noite"]
}
var DAY_PART_WORDS = {
  morning: ["morning", "manha"],
  afternoon: ["afternoon", "tarde"],
  evening: ["evening", "night", "noite"]
}

// Repeats, by the event form's presets. "every monday" and "toda segunda"
// are read with the weekday, see EVERY_WORDS.
var REPEAT_PHRASES = {
  daily: ["every day", "everyday", "each day", "daily", "todo dia", "todos os dias", "diariamente"],
  weekdays: ["every weekday", "every workday", "weekdays", "dias uteis", "todo dia util",
    "todos os dias uteis", "em dias uteis", "nos dias uteis", "dias de semana"],
  weekly: ["every week", "each week", "weekly", "toda semana", "todas as semanas", "semanalmente"],
  monthly: ["every month", "each month", "monthly", "todo mes", "todos os meses", "mensalmente"],
  yearly: ["every year", "each year", "yearly", "annually", "todo ano", "todos os anos", "anualmente"]
}
// As the first word these name the event ("Weekly review"), not a repeat.
var REPEAT_TITLE_WORDS = ["daily", "weekly", "monthly", "yearly"]
// Before a weekday, a weekly repeat on that day: "every monday", "toda segunda".
var EVERY_WORDS = ["every", "each", "toda", "todo", "todas as", "todos os", "a cada"]
// Before a weekday in the plural, the same: "on mondays", "nas segundas".
var PLURAL_DAY_WORDS = ["on", "nas", "nos", "aos"]
