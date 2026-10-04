import { demoClient } from './demo'

// Tech demo build: always the in-memory mock. There is no real backend here.
export const DEMO = true

export const supabase = demoClient

// ---- date helpers (Mon-based weeks) ----
export function startOfWeek(d = new Date()) {
  const date = new Date(d)
  const day = (date.getDay() + 6) % 7 // Mon=0
  date.setDate(date.getDate() - day)
  date.setHours(0, 0, 0, 0)
  return date
}

export function addDays(d, n) {
  const date = new Date(d)
  date.setDate(date.getDate() + n)
  return date
}

export function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function weekDays(weekStart) {
  return [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i))
}

export function fmtDay(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'short' })
}

export function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function fmtRange(weekStart) {
  const end = addDays(weekStart, 4)
  return `${fmtDate(weekStart)} – ${fmtDate(end)}`
}

export function isToday(d) {
  return toISODate(d) === toISODate(new Date())
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

// muted, brand-adjacent tones for initials avatars
const PALETTE = ['#4a5d23', '#7a5c00', '#2f5d62', '#6b4226', '#3d3d35', '#5c7a00', '#8a4f3d', '#46604f', '#5a4a6b', '#705a36']
export function colorFor(id = '') {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
