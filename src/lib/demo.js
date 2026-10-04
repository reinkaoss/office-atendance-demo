// In-memory mock of the Supabase client for demo/preview mode.
// Active only when built with VITE_DEMO=1 (npm run build:demo). Never enabled on
// the production build — see src/lib/supabase.js.
const ME = 'demo-victor'

const NAMES = [
  ['demo-victor', 'Victor Mills', true],
  ['u-amara', 'Amara Okafor', false],
  ['u-james', 'James Whitfield', false],
  ['u-priya', 'Priya Sharma', true],
  ['u-tom', 'Tom Davies', false],
  ['u-sofia', 'Sofia Rossi', false],
  ['u-marcus', 'Marcus Chen', false],
  ['u-ellie', 'Ellie Thompson', false],
  ['u-dan', 'Dan Kowalski', false],
]

const profiles = NAMES.map(([id, full_name, is_admin], i) => ({
  id,
  full_name,
  email: `${full_name.split(' ')[0].toLowerCase()}@rmpenterprise.co.uk`,
  avatar_url: null,
  slack_user_id: id === 'u-dan' ? null : `U0${id.slice(2).toUpperCase()}X${id.length}`,
  is_admin,
  is_super_admin: id === 'demo-victor',
  office_group: id === 'demo-victor' ? 'A' : i % 2 ? 'B' : 'A',
  created_at: new Date().toISOString(),
}))

const office_groups = [
  { grp: 'A', label: 'Group A', days: '2' },
  { grp: 'B', label: 'Group B', days: '4' },
]

function iso(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
function monday(offsetWeeks = 0) {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetWeeks * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

// deterministic pseudo-random
let seed = 42
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const attendance = []
let nextId = 1
for (let w = -4; w <= 1; w++) {
  const mon = monday(w)
  for (const p of profiles) {
    for (let day = 0; day < 5; day++) {
      // each person has favourite days; ~50% office overall
      const bias = (p.id.charCodeAt(2) + day) % 5 < 2 ? 0.75 : 0.35
      if (rnd() < bias) {
        const d = new Date(mon)
        d.setDate(d.getDate() + day)
        // past office days mostly got confirmed via the day-of check-in; future ones haven't
        const confirmed = w < 0 ? rnd() < 0.85 : w === 0 ? rnd() < 0.4 : false
        const day_part = rnd() < 0.15 ? ['morning', 'afternoon', 'event'][Math.floor(rnd() * 3)] : 'full'
        attendance.push({ id: nextId++, user_id: p.id, date: iso(d), profiles: p, confirmed, day_part })
      }
    }
  }
}

const week_confirmations = profiles
  .filter((_, i) => i % 3 !== 0) // some pending
  .map((p) => ({ user_id: p.id, week_start: iso(monday(0)), profiles: p }))

const app_settings = [
  { key: 'slack_channel_id', value: 'C0DEMO12345' },
  { key: 'admin_bootstrap_email', value: 'admin@example.com' },
  { key: 'test_mode', value: '1' },
  { key: 'desk_capacity', value: '32' },
]

const office_closures = [
  { date: iso(new Date(monday(1).getTime() + 2 * 86400000)), label: 'Bank holiday' },
]

const notification_log = [
  { id: nextId++, type: 'weekly_summary', sent: true, ran_at: new Date().toISOString() },
  { id: nextId++, type: 'daily', sent: true, ran_at: new Date().toISOString() },
  { id: nextId++, type: 'compliance_digest', sent: false, ran_at: new Date().toISOString() },
]

const office_events = [
  { id: nextId++, date: iso(new Date(monday(0).getTime() + 2 * 86400000)), title: 'Team lunch 🍕' },
  { id: nextId++, date: iso(new Date(monday(1).getTime() + 3 * 86400000)), title: 'All-hands + drinks 🍻' },
]

// some people take holidays (weekOffset, weekday indexes 0=Mon … 4=Fri)
const holidays = []
;[
  ['u-tom', 0, [0, 1, 2, 3, 4]], // Tom off the whole of this week
  ['u-sofia', 0, [3, 4]], // Sofia off Thu–Fri this week
  ['demo-victor', 1, [0, 1]], // Victor off Mon–Tue next week
  ['u-amara', -1, [2]], // Amara off a day last week
].forEach(([uid, wk, dayList]) => {
  const mon = monday(wk)
  for (const day of dayList) {
    const d = new Date(mon)
    d.setDate(d.getDate() + day)
    holidays.push({ id: nextId++, user_id: uid, date: iso(d), profiles: profiles.find((p) => p.id === uid) || null })
  }
})
// holiday and office attendance are mutually exclusive — drop any seeded clashes
const holidaySet = new Set(holidays.map((h) => `${h.user_id}|${h.date}`))
for (let i = attendance.length - 1; i >= 0; i--) {
  if (holidaySet.has(`${attendance[i].user_id}|${attendance[i].date}`)) attendance.splice(i, 1)
}

function firstOfMonth(offset = 0) {
  const d = new Date()
  return iso(new Date(d.getFullYear(), d.getMonth() + offset, 1))
}

const eotm_votes = [
  { voter_id: 'u-amara', nominee_id: 'u-priya', reason: 'Carried the release single-handedly while half the team was off.', month: firstOfMonth() },
  { voter_id: 'u-james', nominee_id: 'u-priya', reason: 'Always first to help, fixed the deploy pipeline twice.', month: firstOfMonth() },
  { voter_id: 'u-tom', nominee_id: 'u-sofia', reason: 'Brilliant client demo that saved the renewal.', month: firstOfMonth() },
  { voter_id: 'u-ellie', nominee_id: 'u-marcus', reason: 'Mentored two new joiners without being asked.', month: firstOfMonth() },
]

const eotm_results = [
  { month: firstOfMonth(-1), winner_ids: ['u-amara'], vote_count: 4 },
  { month: firstOfMonth(-2), winner_ids: ['u-marcus', 'u-sofia'], vote_count: 3 },
]

// declared "not in" with reasons (some public, some admin-only)
const absences = []
;[
  ['u-james', 0, [1], 'Working from home', false, true],
  ['u-priya', 0, [2], 'Client visit', true, true],
  ['u-ellie', 0, [0], 'Personal appointment', true, false],
].forEach(([uid, wk, dayList, reason, adminOnly, isPublic]) => {
  const mon = monday(wk)
  const p = profiles.find((x) => x.id === uid)
  for (const day of dayList) {
    const d = new Date(mon)
    d.setDate(d.getDate() + day)
    absences.push({ id: nextId++, user_id: uid, date: iso(d), reason, reason_admin_only: adminOnly, is_public: isPublic, profiles: p })
  }
})
const absenceSet = new Set(absences.map((a) => `${a.user_id}|${a.date}`))
for (let i = attendance.length - 1; i >= 0; i--) {
  if (absenceSet.has(`${attendance[i].user_id}|${attendance[i].date}`)) attendance.splice(i, 1)
}

const db = { profiles, attendance, week_confirmations, app_settings, office_events, eotm_votes, eotm_results, holidays, absences, office_groups, office_closures, notification_log, feedback: [] }

function makeQuery(tableName) {
  const tn = tableName === 'absences_v' ? 'absences' : tableName // view reads the same array
  const state = { op: 'select', filters: [], single: false, payload: null }
  const api = {
    select() { return api },
    insert(payload) { state.op = 'insert'; state.payload = payload; return api },
    upsert(payload) { state.op = 'upsert'; state.payload = payload; return api },
    update(payload) { state.op = 'update'; state.payload = payload; return api },
    delete() { state.op = 'delete'; return api },
    eq(k, v) { state.filters.push((r) => r[k] === v); return api },
    in(k, arr) { state.filters.push((r) => arr.includes(r[k])); return api },
    gte(k, v) { state.filters.push((r) => r[k] >= v); return api },
    lte(k, v) { state.filters.push((r) => r[k] <= v); return api },
    order() { return api },
    single() { state.single = true; return api },
    maybeSingle() { state.single = true; return api },
    then(resolve) {
      const rows = db[tn] || []
      const match = (r) => state.filters.every((f) => f(r))
      let data = null
      if (state.op === 'select') {
        const out = rows.filter(match)
        data = state.single ? out[0] ?? null : out
      } else if (state.op === 'insert') {
        const row = { id: nextId++, ...state.payload }
        if (tn === 'attendance' || tn === 'holidays') row.profiles = profiles.find((p) => p.id === row.user_id) || null
        if (tn === 'attendance' && !row.day_part) row.day_part = 'full'
        if (tn === 'absences') row.profiles = profiles.find((x) => x.id === row.user_id) || null
        rows.push(row)
        notify()
      } else if (state.op === 'delete') {
        db[tn] = rows.filter((r) => !match(r))
        notify()
      } else if (state.op === 'update') {
        rows.filter(match).forEach((r) => Object.assign(r, state.payload))
        notify()
      } else if (state.op === 'upsert') {
        const pl = state.payload
        const key = pl && pl.date ? 'date' : 'week_start'
        if (pl && pl.user_id && pl[key] != null) {
          db[tn] = rows.filter((r) => !(r.user_id === pl.user_id && r[key] === pl[key]))
          const row = { id: nextId++, ...pl }
          if (tn === 'absences') row.profiles = profiles.find((x) => x.id === row.user_id) || null
          db[tn].push(row)
        } else {
          rows.push({ ...pl })
        }
        notify()
      }
      resolve({ data, error: null })
    },
  }
  return api
}

const listeners = new Set()
function notify() {
  setTimeout(() => listeners.forEach((fn) => fn()), 0)
}

export const demoClient = {
  auth: {
    async getSession() {
      return { data: { session: { user: { id: ME } } } }
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } }
    },
    async signInWithOAuth() {},
    async signOut() {
      alert('Demo mode — sign-in/out is disabled. This is sample data.')
    },
  },
  from: (t) => makeQuery(t),
  async rpc(name, params) {
    if (name === 'get_notification_schedule') {
      return {
        data: [
          { jobname: 'slack-daily', schedule: '30 7 * * 1-5', active: true },
          { jobname: 'slack-attendance-check', schedule: '0 10 * * 1-5', active: true },
          { jobname: 'slack-prebook-reminder', schedule: '0 15 * * *', active: true },
          { jobname: 'slack-compliance-digest', schedule: '0 8 * * 1', active: true },
          { jobname: 'slack-eotm-announce', schedule: '0 8 1 * *', active: true },
          { jobname: 'slack-eotm-reminder', schedule: '0 9 * * *', active: true },
          { jobname: 'slack-reminders', schedule: '0 13 * * 5', active: true },
          { jobname: 'slack-weekly-summary', schedule: '0 7 * * 1', active: true },
        ],
        error: null,
      }
    }
    if (name === 'eotm_turnout') {
      return { data: [{ voted: db.eotm_votes.length, total: db.profiles.length }], error: null }
    }
    if (name === 'eotm_voters') {
      return { data: db.eotm_votes.map((v) => v.voter_id), error: null }
    }
    if (name === 'delete_employee') {
      db.profiles = db.profiles.filter((p) => p.id !== params?.p_user_id)
      return { data: null, error: null }
    }
    if (name === 'eotm_standings') {
      const counts = {}
      for (const v of db.eotm_votes) counts[v.nominee_id] = (counts[v.nominee_id] || 0) + 1
      return {
        data: Object.entries(counts)
          .map(([nominee_id, votes]) => ({ nominee_id, votes }))
          .sort((a, b) => b.votes - a.votes),
        error: null,
      }
    }
    return { data: null, error: null }
  },
  functions: {
    async invoke(_name, { body } = {}) {
      if (body?.action === 'list_channels') {
        return {
          data: {
            channels: [
              { id: 'C0DEMO12345', name: 'bookadesk_dev', is_member: true, is_private: true },
              { id: 'C0DEMO99999', name: 'general', is_member: true, is_private: false },
              { id: 'C0DEMO55555', name: 'random', is_member: false, is_private: false },
            ],
          },
          error: null,
        }
      }
      return { data: { sent: `${body?.type} (demo — nothing actually sent)` }, error: null }
    },
  },
  channel() {
    const ch = {
      on(_a, _b, cb) { ch._cb = cb; return ch },
      subscribe() { if (ch._cb) listeners.add(ch._cb); return ch },
    }
    return ch
  },
  removeChannel(ch) { if (ch?._cb) listeners.delete(ch._cb) },
}
