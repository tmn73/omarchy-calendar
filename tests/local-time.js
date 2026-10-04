// Times built in the machine's own timezone, so tests about local days hold
// wherever they run (and across DST changes).
const pad = (n) => String(n).padStart(2, '0')

// An ISO string with this machine's offset for that local wall-clock time.
function localIso(year, month, day, hours = 0, minutes = 0) {
  const date = new Date(year, month, day, hours, minutes)
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

const localMs = (year, month, day, hours = 0, minutes = 0) => new Date(year, month, day, hours, minutes).getTime()

module.exports = { localIso, localMs }
