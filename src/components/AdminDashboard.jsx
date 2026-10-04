import { useEffect, useMemo, useState } from 'react'
import { Download, FlaskConical, Send, BellRing, RefreshCw, Search, ChevronLeft, ChevronRight, MessageSquareText, RotateCcw, Pencil, X, Clock, ArrowUpDown, ArrowUp, ArrowDown, Check, Users, CalendarCheck, Home, Palmtree, Ban, GripVertical, Trash2 } from 'lucide-react'
import { supabase, toISODate, startOfWeek, addDays } from '../lib/supabase'
import Avatar from './Avatar'

const NOTIFICATIONS = [
  {
    type: 'weekly_summary', job: 'slack-weekly-summary', name: 'Weekly summary', delivery: 'channel',
    desc: "Who's in which days this week, posted to a channel",
    templateKey: 'template_weekly', vars: '{week}',
    help: 'Headline above the day-by-day breakdown (which is generated automatically).',
  },
  {
    type: 'daily', job: 'slack-daily', name: "Daily who's-in", delivery: 'channel',
    desc: "Today's office attendees, posted each weekday morning",
    templateKey: 'template_daily', vars: '{count}, {names}',
    help: 'The full daily message. {names} becomes the @-mention list.',
  },
  {
    type: 'reminders', job: 'slack-reminders', name: 'Plan-your-week reminder', delivery: 'dm',
    desc: "Nudges people who haven't picked any office days (or holiday) for next week",
    templateKey: 'template_reminder', vars: '{first_name}, {week}, {app_url}',
    help: 'Each person receives their own private DM — {first_name} is filled in per recipient. Never posted to a channel.',
  },
  {
    type: 'attendance_check', job: 'slack-attendance-check', name: 'Office check-in', delivery: 'dm',
    desc: "Day-of 'are you in today?' DM to anyone marked in but not yet confirmed",
    templateKey: 'template_attendance_check', vars: '{first_name}',
    help: "A private DM with two buttons. “I’m in” confirms the person for today; “Not today” removes them from the day. Needs Slack Interactivity + SLACK_SIGNING_SECRET (see README).",
  },
  {
    type: 'prebook_reminder', job: 'slack-prebook-reminder', name: 'Day-before check', delivery: 'dm',
    desc: "Afternoon-before DM to anyone booked for tomorrow — “still coming in?”",
    templateKey: 'template_prebook', vars: '{first_name}, {day}',
    help: "A private DM the day before someone is booked in. “Still coming” acknowledges; “Can't make it” removes their booking so the desk frees up. {day} is tomorrow's date. Needs Slack Interactivity + SLACK_SIGNING_SECRET.",
  },
  {
    type: 'compliance_digest', job: 'slack-compliance-digest', name: 'Weekly non-compliance digest', delivery: 'channel',
    desc: 'Posts who did not come in last week (Monday) — makes the once-a-week policy self-enforcing',
    templateKey: 'template_compliance', vars: '{week}, {count}, {names}',
    help: 'Posted to a channel. {names} becomes the @-mention list of people who had no office day and no holiday last week.',
  },
  {
    type: 'eotm_reminder', job: 'slack-eotm-reminder', name: 'EotM vote reminder', delivery: 'dm',
    desc: "Nudges people who haven't voted — daily, but only over the last 3 days of the month",
    templateKey: 'template_eotm_reminder', vars: '{first_name}, {month_name}, {days_left}, {app_url}',
    help: "Each person receives their own private DM — {first_name} is filled in per recipient, and anyone who has already voted is skipped. The job runs every day but stays silent until the last 3 days of the month, so {days_left} reads “3 days”, “tomorrow” or “today”. A manual test ignores the date window. Never posted to a channel.",
  },
  {
    type: 'eotm_announce', job: 'slack-eotm-announce', name: 'EotM announcement', delivery: 'channel',
    desc: "Posts last month's Employee of the Month winner",
    templateKey: 'template_eotm_announce', vars: '{month_name}, {winners}, {votes}', monthly: true,
    help: 'Posted to a channel. A manual test announces the current month standings without saving a result.',
  },
]

const DAY_OPTIONS = [
  { value: '1', label: 'Mondays' },
  { value: '2', label: 'Tuesdays' },
  { value: '3', label: 'Wednesdays' },
  { value: '4', label: 'Thursdays' },
  { value: '5', label: 'Fridays' },
  { value: '1-5', label: 'Every weekday (Mon–Fri)' },
  { value: '*', label: 'Every day' },
]

export const DEFAULT_TEMPLATES = {
  template_weekly: '🏢 Office week of {week}',
  template_daily: '☀️ *In the office today* ({count})',
  template_reminder: "Hi {first_name}! 👋 You haven't picked any office days for next week (w/c {week}) yet. Plan your days here: {app_url}",
  template_attendance_check: "Hi {first_name}! 👋 You're down for the office today — are you in?",
  template_prebook: "Hi {first_name}! 👋 You're due to attend the office tomorrow ({day}) — still coming in?",
  template_compliance: "📋 *Office check — w/c {week}*\n{count} didn't make it in last week: {names}",
  template_eotm_reminder: '🏆 Hi {first_name}! Voting for Employee of the Month ({month_name}) closes in {days_left} — cast your vote: {app_url}',
  template_eotm_announce: '🏆 *Employee of the Month — {month_name}*\nCongratulations {winners}! 🎉 ({votes} votes)',
}

const DOW_LABELS = { '*': 'Every day', '1': 'Mondays', '2': 'Tuesdays', '3': 'Wednesdays', '4': 'Thursdays', '5': 'Fridays', '1-5': 'Mon–Fri' }
const WD_ABBR = { 1: 'Mo', 2: 'Tu', 3: 'We', 4: 'Th', 5: 'Fr' }
const WD_FULL = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' }
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
function cronHuman(cron) {
  const parts = (cron || '').split(' ')
  if (parts.length !== 5) return cron
  const [m, h, dom, , dow] = parts
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} London`
  if (dom !== '*') return `${ordinal(Number(dom))} of the month ${time}`
  const day = DOW_LABELS[dow] || `cron: ${cron}`
  return `${day} ${time}`
}

function channelLabel(channelId, channels) {
  if (!channelId) return 'no channel set'
  const match = (channels || []).find?.((c) => c.id === channelId)
  return match ? `#${match.name}` : channelId
}

function NotificationModal({ notif, job, settings, channels, onClose, onSaved, showToast }) {
  const [m, h, dom, , dow] = (job?.schedule || '0 8 * * 1-5').split(' ')
  const [day, setDay] = useState(dow)
  const [dayOfMonth, setDayOfMonth] = useState(dom !== '*' ? Number(dom) : 1)
  const [time, setTime] = useState(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  const [tpl, setTpl] = useState(settings[notif.templateKey]?.trim() || DEFAULT_TEMPLATES[notif.templateKey])
  const [chan, setChan] = useState(settings[`channel_${notif.type}`] || '')
  const [saving, setSaving] = useState(false)
  const isDefault = tpl.trim() === DEFAULT_TEMPLATES[notif.templateKey]

  const save = async () => {
    if (!tpl.trim()) { showToast('Message cannot be empty'); return }
    setSaving(true)
    const [hh, mm] = time.split(':')
    const cron = notif.monthly
      ? `${Number(mm)} ${Number(hh)} ${dayOfMonth} * *`
      : `${Number(mm)} ${Number(hh)} * * ${day}`
    const tplValue = isDefault ? '' : tpl.trim()
    const now = new Date().toISOString()
    const upserts = [{ key: notif.templateKey, value: tplValue, updated_at: now }]
    if (notif.delivery === 'channel') {
      upserts.push({ key: `channel_${notif.type}`, value: chan.trim(), updated_at: now })
    }
    const r1 = await supabase.from('app_settings').upsert(upserts, { onConflict: 'key' })
    let scheduleError = null
    if (cron !== job?.schedule && supabase.rpc) {
      const r2 = await supabase.rpc('update_notification_schedule', { p_jobname: notif.job, p_schedule: cron })
      scheduleError = r2.error
    }
    setSaving(false)
    if (r1.error || scheduleError) showToast(scheduleError ? 'Schedule update failed' : 'Could not save')
    else {
      showToast(`${notif.name} updated`)
      onSaved()
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <BellRing size={16} style={{ color: 'var(--lime-dark)' }} />
          <h3>{notif.name}</h3>
          <div className="spacer" />
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <p className="modal-sub">{notif.desc}.</p>

        <div className="modal-label">
          <Clock size={13} /> Schedule
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {notif.monthly ? (
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}>
              Day of month
              <input
                type="number" min={1} max={28} value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
                style={{ width: 64, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px' }}
              />
            </label>
          ) : (
            <select value={day} onChange={(e) => setDay(e.target.value)}>
              {DAY_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          )}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <span style={{ fontSize: 12.5, color: 'var(--text-3)', alignSelf: 'center' }}>
            London time (BST/GMT handled automatically)
          </span>
        </div>

        <div className="modal-label" style={{ marginTop: 18 }}>
          <Send size={13} /> Destination
        </div>
        {notif.delivery === 'dm' ? (
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, background: 'var(--surface-2)', borderRadius: 9, padding: '9px 12px' }}>
            Sent as a <strong>private DM to each affected person</strong> — placeholders like {'{first_name}'} are
            filled in per recipient, so everyone gets their own personalised message. Nothing is posted to a channel.
            {settings.test_mode === '1' && ' (Test mode is ON: a single preview goes to the default channel instead of any DMs.)'}
          </p>
        ) : channels ? (
          <select value={chan} onChange={(e) => setChan(e.target.value)} style={{ maxWidth: '100%' }}>
            <option value="">Default channel ({channelLabel(settings.slack_channel_id, channels)})</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>#{c.name}{c.is_member ? '' : ' (bot not in channel)'}</option>
            ))}
          </select>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={chan}
              onChange={(e) => setChan(e.target.value)}
              placeholder="C… (empty = default channel)"
              style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', width: 200 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Tip: use "Load channels" in the Notifications panel to pick by name.</span>
          </div>
        )}

        <div className="modal-label" style={{ marginTop: 18 }}>
          <MessageSquareText size={13} /> Message
          <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>placeholders: {notif.vars}</span>
          {!isDefault && (
            <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              onClick={() => setTpl(DEFAULT_TEMPLATES[notif.templateKey])}>
              <RotateCcw size={11} /> Reset to default
            </button>
          )}
        </div>
        <textarea
          value={tpl}
          onChange={(e) => setTpl(e.target.value)}
          rows={notif.templateKey === 'template_reminder' ? 4 : 3}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', font: 'inherit', fontSize: 13.5,
            border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px',
          }}
        />
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
          {notif.help} Slack formatting works: *bold*, _italic_, emoji.
        </div>

        <div className="modal-actions">
          <button className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

function SortIcon({ sort, k }) {
  if (sort.key !== k) return <ArrowUpDown size={11} style={{ opacity: 0.45 }} />
  return sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
}

// parse a YYYY-MM-DD string as a *local* date (avoids UTC drift from new Date(iso))
function parseISO(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

// list of Mondays for every week that the [from, to] range touches
function weeksInRange(fromISO, toISO) {
  const out = []
  let m = startOfWeek(parseISO(fromISO))
  const last = startOfWeek(parseISO(toISO))
  let guard = 0
  while (m <= last && guard < 104) {
    out.push(new Date(m))
    m = addDays(m, 7)
    guard++
  }
  return out
}

export default function AdminDashboard({ profile, showToast }) {
  const isSuper = !!profile?.is_super_admin
  const today = new Date()
  const [adminTab, setAdminTab] = useState('employees') // 'employees' | 'weekly' | 'notifications'
  const [matrixSort, setMatrixSort] = useState({ key: 'name', dir: 'desc' }) // weekly-confirmations sort
  const [weekStart, setWeekStart] = useState(toISODate(startOfWeek(today)))
  const [from, setFrom] = useState(toISODate(addDays(startOfWeek(today), -28)))
  const [to, setTo] = useState(toISODate(addDays(startOfWeek(today), 4)))
  const [profiles, setProfiles] = useState([])
  const [mmmTurns, setMmmTurns] = useState([]) // MMM quote-rotation history (super admin)
  const [mmmNext, setMmmNext] = useState(null) // computed next reader (peek)
  const [mmmNextFollowing, setMmmNextFollowing] = useState(null) // and the one after, from the same rule
  const [mmmDragIdx, setMmmDragIdx] = useState(null) // row being dragged in the rota
  const [mmmMsgOpen, setMmmMsgOpen] = useState(null) // which message editor is expanded: 'reminder' | 'confirm' | null
  const [attendance, setAttendance] = useState([])
  const [holidays, setHolidays] = useState([])
  const [absences, setAbsences] = useState([]) // declared not-in, with reasons (admin sees all)
  const [groups, setGroups] = useState([]) // office_groups (assigned-day groups)
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState([])
  const [notifRuns, setNotifRuns] = useState([]) // notification_log rows from today
  const [channels, setChannels] = useState(null) // null = not loaded
  const [channelsError, setChannelsError] = useState(null)
  const [testChannel, setTestChannel] = useState('')
  const [testing, setTesting] = useState(null)
  const [notifyPick, setNotifyPick] = useState({}) // { [userId]: notificationType }
  const [notifyingId, setNotifyingId] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState({ key: 'full_name', dir: 'asc' })
  const [editNotif, setEditNotif] = useState(null)
  const [votes, setVotes] = useState([])
  const [voters, setVoters] = useState([])
  const [standings, setStandings] = useState([])

  const monthISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  // full-week span covering the range so weekly compliance is computed on whole weeks
  const weekList = useMemo(() => weeksInRange(from, to), [from, to])
  const weekCount = weekList.length || 1
  const spanFromISO = weekList.length ? toISODate(weekList[0]) : from
  const spanToISO = weekList.length ? toISODate(addDays(weekList[weekList.length - 1], 4)) : to

  const load = async () => {
    setLoading(true)
    const [p, a, h, ab, gr, s, v, vt, st] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('attendance').select('user_id, date, confirmed').gte('date', spanFromISO).lte('date', spanToISO),
      supabase.from('holidays').select('user_id, date').gte('date', spanFromISO).lte('date', spanToISO),
      supabase.from('absences').select('user_id, date, reason, is_public, reason_admin_only, profiles:user_id ( full_name, avatar_url )').gte('date', spanFromISO).lte('date', spanToISO),
      supabase.from('office_groups').select('grp, label, days'),
      supabase.from('app_settings').select('key, value'),
      // individual ballots: super admin only (RLS returns just your own row otherwise)
      isSuper
        ? supabase.from('eotm_votes').select('voter_id, nominee_id, reason, updated_at').eq('month', monthISO)
        : Promise.resolve({ data: [] }),
      supabase.rpc ? supabase.rpc('eotm_voters') : Promise.resolve({ data: [] }),
      supabase.rpc ? supabase.rpc('eotm_standings') : Promise.resolve({ data: [] }),
    ])
    setProfiles(p.data || [])
    setAttendance(a.data || [])
    setHolidays(h.data || [])
    setAbsences(ab.data || [])
    setGroups(gr.data || [])
    setVotes(v.data || [])
    setVoters((vt.data || []).map((x) => x?.eotm_voters ?? x))
    setStandings(st.data || [])
    setSettings(Object.fromEntries((s.data || []).map((r) => [r.key, r.value])))
    setLoading(false)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const { data: runs } = await supabase.from('notification_log').select('type, sent, ran_at').gte('ran_at', todayStart.toISOString())
    setNotifRuns(runs || [])
    if (supabase.rpc) {
      const { data: sched } = await supabase.rpc('get_notification_schedule')
      setSchedule(sched || [])
    }
  }

  // invoke slack-admin and surface the real error body even on non-2xx responses.
  // Plain invoke (no custom headers) so supabase-js auto-attaches the auth header,
  // exactly like the working auto-checkin call. Refresh the session first so the
  // token isn't stale on a long-open tab.
  const invokeAdmin = async (body) => {
    await supabase.auth.getSession()
    const { data, error } = await supabase.functions.invoke('slack-admin', { body })
    if (!error) return data
    try {
      return await error.context.json()
    } catch {
      return { error: error.message || 'Request failed' }
    }
  }

  const [syncing, setSyncing] = useState(false)
  const syncFromSlack = async () => {
    setSyncing(true)
    const data = await invokeAdmin({ action: 'sync_users' })
    setSyncing(false)
    if (data?.error) showToast(data?.hint || data?.error || 'Sync failed')
    else {
      showToast(`Slack sync: ${data.created} added, ${data.updated} updated (${data.found} members found)`)
      load()
    }
  }

  const loadChannels = async () => {
    setChannelsError(null)
    setChannels([])
    const data = await invokeAdmin({ action: 'list_channels' })
    if (data?.error) {
      setChannels(null)
      setChannelsError(data?.hint || data?.error || 'Could not load channels')
    } else {
      setChannels(data?.channels || [])
    }
  }

  const sendTest = async (type) => {
    setTesting(type)
    const data = await invokeAdmin({ action: 'test', type, channel: testChannel || undefined })
    setTesting(null)
    if (data?.error) showToast(data?.hint || data?.error || 'Test failed')
    else if (data?.skipped) showToast(`Skipped: ${data.skipped}`)
    else showToast(`Test "${type.replace('_', ' ')}" sent to Slack`)
  }

  // send a single notification to one specific employee (real DM, ignores test mode)
  const sendToUser = async (user) => {
    const type = notifyPick[user.id]
    if (!type) { showToast('Pick a notification first'); return }
    setNotifyingId(user.id)
    const data = await invokeAdmin({ action: 'send_to_user', type, targetUserId: user.id })
    setNotifyingId(null)
    const label = NOTIFICATIONS.find((n) => n.type === type)?.name || type
    if (data?.error) showToast(data?.hint || data?.error || 'Send failed')
    else if (data?.skipped) showToast(`Skipped: ${data.skipped}`)
    else showToast(`Sent "${label}" to ${user.full_name.split(' ')[0]}`)
  }

  const toggleNotifActive = async (n, job) => {
    if (!job) return
    const next = !job.active
    setSchedule((prev) => prev.map((j) => (j.jobname === n.job ? { ...j, active: next } : j)))
    const { error } = supabase.rpc
      ? await supabase.rpc('set_notification_active', { p_jobname: n.job, p_active: next })
      : { error: null }
    if (error) {
      setSchedule((prev) => prev.map((j) => (j.jobname === n.job ? { ...j, active: !next } : j)))
      showToast('Could not update — try again')
    } else {
      showToast(`${n.name} ${next ? 'turned on' : 'turned off'}`)
    }
  }

  useEffect(() => { load() }, [from, to, weekStart])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setEditNotif((n) => (n ? null : n)) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const weekISOs = useMemo(() => weekList.map(toISODate), [weekList])

  // confirmed *attendance* (day-of check-in), keyed by week → set of users with ≥1 confirmed day
  const confirmedByWeek = useMemo(() => {
    const m = {}
    for (const a of attendance) {
      if (!a.confirmed) continue
      const wk = toISODate(startOfWeek(parseISO(a.date)))
      ;(m[wk] ||= new Set()).add(a.user_id)
    }
    return m
  }, [attendance])

  // weeks (Monday ISO) each user attended ≥1 day / had any holiday — drives rate + matrix
  const attendWeeksByUser = useMemo(() => {
    const m = {}
    for (const a of attendance) (m[a.user_id] ||= new Set()).add(toISODate(startOfWeek(parseISO(a.date))))
    return m
  }, [attendance])
  const holidayWeeksByUser = useMemo(() => {
    const m = {}
    for (const h of holidays) (m[h.user_id] ||= new Set()).add(toISODate(startOfWeek(parseISO(h.date))))
    return m
  }, [holidays])
  // weeks each user declared "not in", plus the reasons keyed by user|week (for the matrix tooltip)
  const absenceWeeksByUser = useMemo(() => {
    const m = {}
    for (const a of absences) (m[a.user_id] ||= new Set()).add(toISODate(startOfWeek(parseISO(a.date))))
    return m
  }, [absences])
  const absenceReasonsByUserWeek = useMemo(() => {
    const m = {}
    for (const a of absences) {
      const wk = toISODate(startOfWeek(parseISO(a.date)))
      const label = `${parseISO(a.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${a.reason ? ` — ${a.reason}` : ''}`
      ;(m[`${a.user_id}|${wk}`] ||= []).push(label)
    }
    return m
  }, [absences])
  const dayCounts = useMemo(() => {
    const m = {}
    for (const a of attendance) m[a.user_id] = (m[a.user_id] || 0) + 1
    return m
  }, [attendance])
  // number of people going in (≥1 day) per week — for the matrix column header
  const goingInCountByWeek = useMemo(() => {
    const m = {}
    for (const uid in attendWeeksByUser) for (const wk of attendWeeksByUser[uid]) m[wk] = (m[wk] || 0) + 1
    return m
  }, [attendWeeksByUser])
  // which weekdays (1=Mon..5=Fri) each user was in, per week, for the matrix detail
  const attendDaysByUserWeek = useMemo(() => {
    const m = {}
    for (const a of attendance) {
      const dt = parseISO(a.date)
      const dow = ((dt.getDay() + 6) % 7) + 1
      if (dow < 1 || dow > 5) continue
      const key = `${a.user_id}|${toISODate(startOfWeek(dt))}`
      ;(m[key] ||= new Set()).add(dow)
    }
    return m
  }, [attendance])

  // weekday numbers each group is assigned to attend
  const groupDays = useMemo(() => {
    const m = {}
    for (const g of groups) m[g.grp] = (g.days || '').split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= 5)
    return m
  }, [groups])

  // assigned-day adherence per group, per week (% of group who came on their assigned day)
  const adherence = useMemo(() => {
    return groups.map((g) => {
      const day = groupDays[g.grp]?.[0]
      const members = profiles.filter((p) => p.office_group === g.grp)
      const weeks = weekISOs.map((wk) => {
        let met = 0
        if (day) for (const mb of members) if (attendDaysByUserWeek[`${mb.id}|${wk}`]?.has(day)) met++
        return { wk, met, total: members.length, pct: members.length ? met / members.length : 0 }
      })
      const totMet = weeks.reduce((s, w) => s + w.met, 0)
      const totPoss = members.length * weekISOs.length || 1
      return { grp: g.grp, label: g.label || `Group ${g.grp}`, day, members: members.length, weeks, overall: totMet / totPoss }
    }).filter((x) => x.members > 0)
  }, [groups, groupDays, profiles, weekISOs, attendDaysByUserWeek])
  const holidayCounts = useMemo(() => {
    const m = {}
    for (const h of holidays) m[h.user_id] = (m[h.user_id] || 0) + 1
    return m
  }, [holidays])

  const perUser = useMemo(() => {
    const confirmedThisWeekSet = confirmedByWeek[weekStart] || new Set()
    const votedSet = new Set(voters)
    return profiles.map((p) => {
      const aw = attendWeeksByUser[p.id] || new Set()
      const hw = holidayWeeksByUser[p.id] || new Set()
      // policy: in the office at least once a week; a holiday week counts as met
      let weeksMet = 0
      for (const wk of weekISOs) if (aw.has(wk) || hw.has(wk)) weeksMet++
      return {
        ...p,
        days: dayCounts[p.id] || 0,
        holidayDays: holidayCounts[p.id] || 0,
        weeksMet,
        rate: weeksMet / weekCount,
        confirmedThisWeek: confirmedThisWeekSet.has(p.id),
        votedThisMonth: votedSet.has(p.id),
      }
    })
  }, [profiles, attendWeeksByUser, holidayWeeksByUser, dayCounts, holidayCounts, confirmedByWeek, weekStart, weekISOs, weekCount, voters])

  const eotmTally = useMemo(() => {
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]))
    return standings.map((s) => ({ profile: byId[s.nominee_id], count: Number(s.votes) }))
  }, [standings, profiles])

  const PER_PAGE = 15
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return perUser
    return perUser.filter((u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [perUser, search])
  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key]
      if (typeof va === 'string') return va.localeCompare(vb) * dir
      return (va === vb ? 0 : va > vb ? 1 : -1) * dir
    })
  }, [filtered, sort])

  const toggleSort = (key, numericDefault = false) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: numericDefault ? 'desc' : 'asc' }
    )

  // per-user tally of each weekly status across the visible weeks (for matrix sorting)
  const statusTally = useMemo(() => {
    const m = {}
    for (const u of perUser) {
      const aw = attendWeeksByUser[u.id] || new Set()
      const hw = holidayWeeksByUser[u.id] || new Set()
      let confirmedIn = 0, planned = 0, holiday = 0, absent = 0, notIn = 0
      for (const wk of weekISOs) {
        if (hw.has(wk)) holiday++
        else if (confirmedByWeek[wk]?.has(u.id)) confirmedIn++
        else if (aw.has(wk)) planned++
        else if (absenceWeeksByUser[u.id]?.has(wk)) absent++
        else notIn++
      }
      m[u.id] = { confirmedIn, planned, holiday, absent, notIn }
    }
    return m
  }, [perUser, attendWeeksByUser, holidayWeeksByUser, confirmedByWeek, weekISOs])

  // matrix rows = search-filtered employees, sorted by name or by a chosen status count
  const matrixRows = useMemo(() => {
    const rows = [...filtered]
    if (matrixSort.key === 'name') {
      rows.sort((a, b) => a.full_name.localeCompare(b.full_name))
      return rows
    }
    const dir = matrixSort.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const va = statusTally[a.id]?.[matrixSort.key] || 0
      const vb = statusTally[b.id]?.[matrixSort.key] || 0
      if (va !== vb) return (va - vb) * dir
      return a.full_name.localeCompare(b.full_name)
    })
    return rows
  }, [filtered, matrixSort, statusTally])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = sorted.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE)
  useEffect(() => { setPage(0) }, [search, from, to])

  const stats = useMemo(() => {
    const totalDays = attendance.length
    // average of each person's weekly compliance rate across the range
    const avg = perUser.length ? perUser.reduce((s, u) => s + u.rate, 0) / perUser.length : 0
    const todayISO = toISODate(today)
    const inToday = attendance.filter((a) => a.date === todayISO).length
    const confirmedCount = perUser.filter((u) => u.confirmedThisWeek).length
    return { totalDays, avg, inToday, confirmedCount }
  }, [attendance, perUser])

  const toggleAdmin = async (p) => {
    const { error } = await supabase.from('profiles').update({ is_admin: !p.is_admin }).eq('id', p.id)
    if (error) showToast('Could not update admin role')
    else { showToast(`${p.full_name} is ${p.is_admin ? 'no longer' : 'now'} an admin`); load() }
  }

  // permanently remove an employee (offboarding) — cascades their data. Admins only.
  const removeEmployee = async (u) => {
    if (u.id === profile.id) { showToast("You can't remove your own account"); return }
    if (!window.confirm(`Remove ${u.full_name}?\n\nThis permanently deletes their account, attendance, holidays and votes. It cannot be undone.\n\n(If they're still in Slack, a future "Sync from Slack" would re-add them.)`)) return
    const { error } = supabase.rpc
      ? await supabase.rpc('delete_employee', { p_user_id: u.id })
      : { error: null }
    if (error) showToast(error.message || 'Could not remove — try again')
    else { showToast(`${u.full_name} removed`); load() }
  }

  // Super admin toggle — only a super admin can grant/revoke this (enforced by a DB trigger).
  // Granting super also grants admin, since the Admin tab is gated on is_admin.
  const toggleSuper = async (p) => {
    if (p.id === profile.id) { showToast('Ask another super admin to change your own super-admin status'); return }
    const makeSuper = !p.is_super_admin
    const patch = makeSuper ? { is_super_admin: true, is_admin: true } : { is_super_admin: false }
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id)
    if (error) showToast('Could not update — only a super admin can grant this')
    else { showToast(`${p.full_name} is ${makeSuper ? 'now a super admin 👑' : 'no longer a super admin'}`); load() }
  }

  // ---------- Monday Morning Meeting quote rotation (super admin) ----------
  const mmmRota = useMemo(() => profiles.filter((p) => !p.mmm_excluded).sort((a, b) => (Number(a.mmm_order) - Number(b.mmm_order)) || a.full_name.localeCompare(b.full_name)), [profiles])
  const mmmExcluded = useMemo(() => profiles.filter((p) => p.mmm_excluded).sort((a, b) => a.full_name.localeCompare(b.full_name)), [profiles])
  const profileById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles])
  // the Monday the next meeting falls on (today if it's Monday, else the coming Monday)
  const mmmMonday = (() => {
    const thisMon = startOfWeek(today); const mISO = toISODate(thisMon)
    return toISODate(today) > mISO ? toISODate(addDays(thisMon, 7)) : mISO
  })()
  const mmmUpcomingTurn = mmmTurns.find((t) => t.meeting_date === mmmMonday)
  const mmmReaderId = mmmUpcomingTurn ? mmmUpcomingTurn.user_id : (mmmNext?.id || null)
  const mmmReaderName = mmmUpcomingTurn ? mmmUpcomingTurn.reader_name : (mmmNext?.full_name || null)
  // the meeting after this one: an explicit booking for that date if there is one,
  // otherwise whoever the database says is next. This used to re-implement the
  // rota walk client-side, which meant two copies of the picking rule — and when
  // the database one changed (least-recently-served, Sept 2026) this one would
  // have kept showing the old answer. The database is the only source of truth.
  const mmmFollowingMonday = toISODate(addDays(parseISO(mmmMonday), 7))
  const mmmFollowing = (() => {
    const booked = mmmTurns.find((t) => t.meeting_date === mmmFollowingMonday)
    if (booked) return { date: mmmFollowingMonday, person: profileById[booked.user_id] || { full_name: booked.reader_name }, assigned: true }
    if (!mmmNextFollowing) return null
    // Until Tuesday's confirm run reserves the coming Monday, the database
    // doesn't know about that pick and may answer with the same person for the
    // week after. Better to show nothing than a duplicate.
    if (mmmNextFollowing.id === mmmReaderId) return null
    return { date: mmmFollowingMonday, person: profileById[mmmNextFollowing.id] || mmmNextFollowing, assigned: false }
  })()

  const loadMmm = async () => {
    if (!isSuper) return
    const [t, n, f] = await Promise.all([
      supabase.from('mmm_turns').select('meeting_date, user_id, reader_name, quote, reminded_at, asked_at, confirmed_at, delayed_booking').order('meeting_date', { ascending: false }),
      supabase.rpc('mmm_next_reader'),
      supabase.rpc('mmm_next_reader', { p_for: mmmFollowingMonday }),
    ])
    setMmmTurns(t.data || [])
    setMmmNext((Array.isArray(n.data) ? n.data[0] : n.data) || null)
    setMmmNextFollowing((Array.isArray(f.data) ? f.data[0] : f.data) || null)
  }
  useEffect(() => { loadMmm() }, [isSuper])

  const setMmmReader = async (userId) => {
    const { error } = await supabase.rpc('mmm_set_reader', { p_date: mmmMonday, p_user: userId })
    if (error) showToast('Could not set the reader')
    else { showToast('Reader updated'); loadMmm() }
  }
  const toggleMmmExcluded = async (p) => {
    const { error } = await supabase.from('profiles').update({ mmm_excluded: !p.mmm_excluded }).eq('id', p.id)
    if (error) showToast('Could not update the rota')
    else { showToast(`${p.full_name} ${p.mmm_excluded ? 'added to' : 'removed from'} the MMM rota`); load(); loadMmm() }
  }
  const sendMmmTest = async () => {
    const data = await invokeAdmin({ action: 'test', type: 'mmm_reminder' })
    if (data) showToast('Test posted to the Slack channel')
  }
  const sendMmmConfirmTest = async () => {
    const data = await invokeAdmin({ action: 'test', type: 'mmm_confirm' })
    if (data) showToast('Test posted to the Slack channel')
  }
  // drag a rota row to a new spot — persists a fractional order so only the moved row changes
  const onMmmDrop = async (toIdx) => {
    const from = mmmDragIdx
    setMmmDragIdx(null)
    if (from == null || from === toIdx) return
    const list = [...mmmRota]
    const [moved] = list.splice(from, 1)
    list.splice(toIdx, 0, moved)
    const prev = list[toIdx - 1], next = list[toIdx + 1]
    let newOrder
    if (!prev) newOrder = Number(next?.mmm_order ?? 1) - 1
    else if (!next) newOrder = Number(prev.mmm_order) + 1
    else newOrder = (Number(prev.mmm_order) + Number(next.mmm_order)) / 2
    setProfiles((ps) => ps.map((p) => (p.id === moved.id ? { ...p, mmm_order: newOrder } : p))) // optimistic
    const { error } = await supabase.from('profiles').update({ mmm_order: newOrder }).eq('id', moved.id)
    if (error) { showToast('Could not reorder — try again'); load() }
    else loadMmm()
  }

  const setUserGroup = async (p, grp) => {
    const { error } = await supabase.from('profiles').update({ office_group: grp || null }).eq('id', p.id)
    if (error) showToast('Could not update group')
    else { showToast(`${p.full_name} → ${grp ? `Group ${grp}` : 'no group'}`); load() }
  }


  const saveGroupDays = async (grp, patch) => {
    const { error } = await supabase.from('office_groups').update(patch).eq('grp', grp)
    if (error) showToast('Could not save group')
    else { showToast(`Group ${grp} updated`); setGroups((gs) => gs.map((g) => (g.grp === grp ? { ...g, ...patch } : g))) }
  }

  // weekday numbers a user is assigned to attend, via their group

  const saveSetting = async (key, value, label) => {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) showToast(`Could not save ${label}`)
    else {
      showToast(`${label} saved`)
      setSettings((s) => ({ ...s, [key]: value }))
    }
  }

  const exportCSV = () => {
    const header = `Name,Email,Slack ID,Days in office,Holiday days,Weeks met,Weeks in range,Weekly attendance rate,Confirmed w/c ${weekStart},Voted EotM this month\n`
    const body = perUser
      .map((u) =>
        [u.full_name, u.email, u.slack_user_id || '', u.days, u.holidayDays, u.weeksMet, weekCount, `${Math.round(u.rate * 100)}%`, u.confirmedThisWeek ? 'yes' : 'no', u.votedThisMonth ? 'yes' : 'no']
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(',')
      )
      .join('\n')
    const blob = new Blob([header + body], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `attendance_${from}_to_${to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div>
      <div className="weeknav">
        <div>
          <h2>Admin dashboard</h2>
          <div className="sub">Attendance across the team</div>
        </div>
        <div className="spacer" />
        <button className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} disabled={syncing} onClick={syncFromSlack}>
          <RefreshCw size={15} className={syncing ? 'spin' : ''} /> {syncing ? 'Syncing…' : 'Sync from Slack'}
        </button>
        <button className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={exportCSV}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="subtabs" role="tablist">
        <button className={`subtab ${adminTab === 'employees' ? 'active' : ''}`} role="tab" aria-selected={adminTab === 'employees'} onClick={() => setAdminTab('employees')}>
          <Users size={15} /> Employees
        </button>
        {/* Normal admins get Employees only; everything else is super-admin. */}
        {isSuper && (
        <button className={`subtab ${adminTab === 'weekly' ? 'active' : ''}`} role="tab" aria-selected={adminTab === 'weekly'} onClick={() => setAdminTab('weekly')}>
          <CalendarCheck size={15} /> Weekly confirmations
        </button>
        )}
        {isSuper && (
        <button className={`subtab ${adminTab === 'notifications' ? 'active' : ''}`} role="tab" aria-selected={adminTab === 'notifications'} onClick={() => setAdminTab('notifications')}>
          <BellRing size={15} /> Notifications &amp; Slack
        </button>
        )}
        {isSuper && (
          <button className={`subtab ${adminTab === 'mmm' ? 'active' : ''}`} role="tab" aria-selected={adminTab === 'mmm'} onClick={() => setAdminTab('mmm')}>
            <MessageSquareText size={15} /> MMM quotes
          </button>
        )}
      </div>

      {adminTab === 'employees' && (
      <div className="controls">
        <label>Week commencing
          <input
            type="date"
            value={weekStart}
            onChange={(e) => e.target.value && setWeekStart(toISODate(startOfWeek(parseISO(e.target.value))))}
          />
        </label>
        <button className="iconbtn" onClick={() => setWeekStart(toISODate(addDays(parseISO(weekStart), -7)))} aria-label="Previous week"><ChevronLeft size={15} /></button>
        <button className="iconbtn" onClick={() => setWeekStart(toISODate(addDays(parseISO(weekStart), 7)))} aria-label="Next week"><ChevronRight size={15} /></button>
        <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
          Sets the week used for “Confirmed this week” {weekStart === toISODate(startOfWeek(today)) ? '(current week)' : ''}
        </span>
      </div>
      )}

      {adminTab !== 'notifications' && adminTab !== 'mmm' && (
      <div className="controls">
        <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
          {weekCount} week{weekCount === 1 ? '' : 's'} in range · policy target is ≥1 office day per week ({weekCount} visit{weekCount === 1 ? '' : 's'} = 100%)
        </span>
      </div>
      )}

      {adminTab === 'employees' && (<>
      <div className="statgrid">
        <div className="card stat"><div className="k">{stats.inToday}</div><div className="l">In office today</div></div>
        <div className="card stat"><div className="k">{Math.round(stats.avg * 100)}%</div><div className="l">Avg weekly attendance</div></div>
        <div className="card stat"><div className="k">{stats.totalDays}</div><div className="l">Total office days in range</div></div>
        <div className="card stat"><div className="k">{stats.confirmedCount}/{profiles.length}</div><div className="l">Confirmed w/c {parseISO(weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div></div>
        <div className="card stat"><div className="k">{voters.length}/{profiles.length}</div><div className="l">Voted EotM this month</div></div>
      </div>

      <h3 className="section-title" style={{ marginTop: 0 }}>Employees</h3>
      <div className="card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Search size={15} style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 14 }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            {filtered.length} employee{filtered.length === 1 ? '' : 's'}
          </span>
        </div>
        {loading ? (
          <div style={{ padding: '8px 0' }}>{[...Array(6)].map((_, i) => <div key={i} className="skeleton skeleton-row" />)}</div>
        ) : (
          <table className="report">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('full_name')}>
                  Employee <SortIcon sort={sort} k="full_name" />
                </th>
                <th className="num sortable" style={{ width: 52 }} onClick={() => toggleSort('days', true)}>
                  Days <SortIcon sort={sort} k="days" />
                </th>
                <th className="sortable" onClick={() => toggleSort('rate', true)} title="Weeks with ≥1 office day (or holiday) ÷ weeks in range">
                  Weekly attendance <SortIcon sort={sort} k="rate" />
                </th>
                <th className="sortable" style={{ width: 100 }} onClick={() => toggleSort('confirmedThisWeek', true)}>
                  This week <SortIcon sort={sort} k="confirmedThisWeek" />
                </th>
                <th className="sortable" style={{ width: 92 }} onClick={() => toggleSort('votedThisMonth', true)}>
                  EotM <SortIcon sort={sort} k="votedThisMonth" />
                </th>
                <th style={{ width: 110 }}>Assigned group</th>
                <th style={{ width: 250 }}>Send notification</th>
                <th style={{ width: 56 }}>Admin</th>
                {isSuper && <th style={{ width: 64 }}>Super</th>}
                <th style={{ width: 56 }}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="avatar-row">
                      <Avatar profile={u} size={26} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{u.full_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 700 }} title={u.holidayDays ? `${u.holidayDays} holiday day${u.holidayDays === 1 ? '' : 's'} in range` : undefined}>
                    {u.days}{u.holidayDays > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)' }}> · {u.holidayDays}🌴</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="bar" style={{ flex: 1 }}><div style={{ width: `${Math.min(100, u.rate * 100)}%` }} /></div>
                      <span style={{ fontSize: 12.5, fontWeight: 600, width: 64, textAlign: 'right' }} title={`${u.weeksMet} of ${weekCount} weeks met`}>
                        {Math.round(u.rate * 100)}% <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{u.weeksMet}/{weekCount}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${u.confirmedThisWeek ? 'ok' : 'warn'}`}>
                      {u.confirmedThisWeek ? 'Confirmed' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${u.votedThisMonth ? 'ok' : 'muted'}`}>
                      {u.votedThisMonth ? 'Voted' : 'Not yet'}
                    </span>
                  </td>
                  <td>
                    <select value={u.office_group || ''} onChange={(e) => setUserGroup(u, e.target.value)} style={{ padding: '4px 8px', fontSize: 12.5 }}>
                      <option value="">—</option>
                      {groups.map((g) => <option key={g.grp} value={g.grp}>{g.label || `Group ${g.grp}`}</option>)}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        value={notifyPick[u.id] || ''}
                        onChange={(e) => setNotifyPick((p) => ({ ...p, [u.id]: e.target.value }))}
                        style={{ padding: '4px 8px', fontSize: 12.5, flex: 1, minWidth: 0 }}
                      >
                        <option value="">Choose…</option>
                        {NOTIFICATIONS.map((n) => <option key={n.type} value={n.type}>{n.name}</option>)}
                      </select>
                      <button
                        className="btn secondary"
                        style={{ padding: '5px 10px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
                        disabled={!notifyPick[u.id] || notifyingId === u.id}
                        title={`DM the selected notification to ${u.full_name} only`}
                        onClick={() => sendToUser(u)}
                      >
                        <Send size={13} />{notifyingId === u.id ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  </td>
                  <td>
                    <label className="switch" title={u.is_super_admin ? 'Super admins are always admins' : ''}>
                      <input type="checkbox" checked={!!u.is_admin || !!u.is_super_admin} disabled={!!u.is_super_admin} onChange={() => toggleAdmin(u)} />
                      <span className="track" />
                    </label>
                  </td>
                  {isSuper && (
                    <td>
                      <label className="switch" title={u.id === profile.id ? "You can't change your own super-admin status" : ''}>
                        <input type="checkbox" checked={!!u.is_super_admin} disabled={u.id === profile.id} onChange={() => toggleSuper(u)} />
                        <span className="track" />
                      </label>
                    </td>
                  )}
                  <td>
                    {u.id !== profile.id && !u.is_super_admin && (isSuper || !u.is_admin) && (
                      <button
                        className="iconbtn"
                        title={`Remove ${u.full_name}`}
                        onClick={() => removeEmployee(u)}
                        style={{ color: 'var(--red)' }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pageCount > 1 && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
              {safePage * PER_PAGE + 1}–{Math.min((safePage + 1) * PER_PAGE, filtered.length)} of {filtered.length}
            </span>
            <button className="iconbtn" disabled={safePage === 0} style={{ opacity: safePage === 0 ? 0.4 : 1 }} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
              <ChevronLeft size={15} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{safePage + 1} / {pageCount}</span>
            <button className="iconbtn" disabled={safePage >= pageCount - 1} style={{ opacity: safePage >= pageCount - 1 ? 0.4 : 1 }} onClick={() => setPage(safePage + 1)} aria-label="Next page">
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      <h3 className="section-title">Assigned office days</h3>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
          Set the default office day for each group. Each employee’s assigned day comes from the group they’re in (above), and shows at the top of their calendar.
        </span>
        {groups.map((g) => (
          <div key={g.grp} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              defaultValue={g.label}
              onBlur={(e) => e.target.value.trim() !== g.label && saveGroupDays(g.grp, { label: e.target.value.trim() })}
              style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px', width: 150, fontWeight: 600 }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>assigned day</span>
            <select value={(g.days || '').split(',')[0] || ''} onChange={(e) => saveGroupDays(g.grp, { days: e.target.value })}>
              <option value="">None</option>
              {DAY_OPTIONS.filter((d) => ['1', '2', '3', '4', '5'].includes(d.value)).map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{profiles.filter((p) => p.office_group === g.grp).length} people</span>
          </div>
        ))}
      </div>

      <h3 className="section-title">Office capacity</h3>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontWeight: 600, fontSize: 13.5 }}>Desk capacity</label>
          <input
            type="number" min={0}
            defaultValue={settings.desk_capacity || ''}
            onBlur={(e) => e.target.value !== (settings.desk_capacity || '') && saveSetting('desk_capacity', String(Number(e.target.value) || 0), 'Desk capacity')}
            style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px', width: 90 }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Max people in the office per day. The calendar warns when nearly full and blocks bookings once full. (0 = unlimited)</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
          To close the office on a specific day (e.g. filming), open that day in the calendar and use <strong>Close the office</strong>. Closed days block bookings, clear any existing ones, and post a Slack notice that morning.
        </div>
      </div>
      </>)}

      {adminTab === 'weekly' && (<>
      {adherence.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: 0 }}>Assigned-day adherence</h3>
          <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 16 }}>
            {adherence.map((g) => (
              <div key={g.grp}>
                <div className="adh-head">
                  <strong>{g.label}</strong>
                  <span className="adh-sub">{g.day ? WD_FULL[g.day] : 'no assigned day'} · {g.members} {g.members === 1 ? 'person' : 'people'}</span>
                  <span className="spacer" />
                  <span className={`badge ${g.overall >= 0.8 ? 'ok' : g.overall >= 0.5 ? 'warn' : 'muted'}`}>{Math.round(g.overall * 100)}% overall</span>
                </div>
                <div className="adh-cells">
                  {g.weeks.map((w) => {
                    const pct = Math.round(w.pct * 100)
                    return (
                      <div key={w.wk} className="adh-cellwrap">
                        <div
                          className="adh-cell"
                          title={`${w.met} of ${w.total} came in on ${g.day ? WD_FULL[g.day] : 'their day'}`}
                          style={{ background: w.pct === 0 ? 'var(--surface-2)' : `rgba(124, 156, 12, ${0.18 + 0.82 * w.pct})` }}
                        >
                          <span className="adh-cell-pct" style={{ color: w.pct >= 0.5 ? '#fff' : 'var(--ink)' }}>{pct}<span className="adh-cell-sign">%</span></span>
                          <span className="adh-cell-n" style={{ color: w.pct >= 0.5 ? 'rgba(255,255,255,0.85)' : 'var(--text-3)' }}>{w.met}/{w.total}</span>
                        </div>
                        <span className="adh-cell-wk">{new Date(w.wk + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <h3 className="section-title" style={adherence.length > 0 ? undefined : { marginTop: 0 }}>Weekly confirmations</h3>
      <div className="card" style={{ padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={15} style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 14, minWidth: 160 }}
          />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>
          Sort
          <select
            value={matrixSort.key}
            onChange={(e) => setMatrixSort((s) => ({ key: e.target.value, dir: e.target.value === 'name' ? 'asc' : 'desc' }))}
          >
            <option value="name">Name (A–Z)</option>
            <option value="confirmedIn">Confirmed in</option>
            <option value="planned">Planned (not confirmed)</option>
            <option value="absent">Declared not-in</option>
            <option value="holiday">On holiday</option>
            <option value="notIn">No response</option>
          </select>
        </label>
        {matrixSort.key !== 'name' && (
          <button
            className="btn ghost"
            style={{ padding: '5px 10px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onClick={() => setMatrixSort((s) => ({ ...s, dir: s.dir === 'desc' ? 'asc' : 'desc' }))}
            title="Flip whether the most of that status appears at the top or bottom"
          >
            {matrixSort.dir === 'desc' ? <><ArrowUp size={12} /> Most on top</> : <><ArrowDown size={12} /> Most on bottom</>}
          </button>
        )}
        <div className="spacer" />
        <span className="matrix-legend"><span className="matrix-yes"><Check size={11} strokeWidth={3} /></span> Confirmed in <span style={{ color: 'var(--text-3)' }}>(★ = made assigned day)</span></span>
        <span className="matrix-legend"><span className="matrix-not"><Home size={11} /></span> Planned (not confirmed)</span>
        <span className="matrix-legend"><span className="matrix-absent"><Ban size={11} /></span> Declared not-in</span>
        <span className="matrix-legend"><span className="matrix-hol">🌴</span> On holiday</span>
        <span className="matrix-legend"><span className="matrix-no">·</span> No response</span>
      </div>
      <div className="card" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '8px 0' }}>{[...Array(6)].map((_, i) => <div key={i} className="skeleton skeleton-row" />)}</div>
        ) : (
          <table className="report matrix">
            <thead>
              <tr>
                <th className="matrix-name">Employee</th>
                {weekList.map((mon) => {
                  const wk = toISODate(mon)
                  return (
                    <th key={wk} className="num matrix-week">
                      <div>{mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-3)' }}>{confirmedByWeek[wk]?.size || 0}/{goingInCountByWeek[wk] || 0}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((u) => (
                <tr key={u.id}>
                  <td className="matrix-name">
                    <div className="avatar-row">
                      <Avatar profile={u} size={22} />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{u.full_name}</span>
                    </div>
                  </td>
                  {weekISOs.map((wk) => {
                    const onHoliday = holidayWeeksByUser[u.id]?.has(wk)
                    const confirmed = confirmedByWeek[wk]?.has(u.id)
                    const planned = attendWeeksByUser[u.id]?.has(wk)
                    const declaredOut = absenceWeeksByUser[u.id]?.has(wk)
                    const reasons = absenceReasonsByUserWeek[`${u.id}|${wk}`]
                    const assigned = groupDays[u.office_group] || []
                    const inDays = [...(attendDaysByUserWeek[`${u.id}|${wk}`] || [])].sort()
                    const metAssigned = inDays.some((d) => assigned.includes(d))
                    return (
                      <td key={wk} className="num matrix-cell">
                        {onHoliday ? (
                          <span className="matrix-hol" title="On holiday">🌴</span>
                        ) : confirmed ? (
                          <span className="matrix-confirmed" title={`Confirmed in${assigned.length ? (metAssigned ? ' · made assigned day' : ' · not on assigned day') : ''}`}>
                            <span className={`matrix-yes ${metAssigned ? 'assigned' : ''}`}>{metAssigned ? '★' : <Check size={12} strokeWidth={3} />}</span>
                            <span className="matrix-days">
                              {inDays.map((d) => <span key={d} className={assigned.includes(d) ? 'on' : ''}>{WD_ABBR[d]}</span>)}
                            </span>
                          </span>
                        ) : planned ? (
                          <span className="matrix-not" title="Planned in, not yet confirmed"><Home size={12} /></span>
                        ) : declaredOut ? (
                          <span className="matrix-absent" title={reasons ? reasons.join('\n') : 'Declared not in'}><Ban size={12} /></span>
                        ) : (
                          <span className="matrix-no" title="No response">·</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {absences.length > 0 && (
        <>
          <h3 className="section-title">Not-in reasons</h3>
          <div className="card" style={{ padding: '6px 0' }}>
            {[...absences]
              .sort((a, b) => a.date.localeCompare(b.date) || (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
              .map((a, i) => (
                <div key={i} className="notin-row">
                  <Avatar profile={a.profiles || { id: a.user_id, full_name: '?' }} size={24} absent />
                  <span className="notin-row-name">{a.profiles?.full_name || 'Someone'}</span>
                  <span className="notin-row-date">{parseISO(a.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                  <span className="notin-row-reason">{a.reason ? `“${a.reason}”` : <em style={{ color: 'var(--text-3)' }}>no reason given</em>}</span>
                  <span className={`badge ${a.is_public ? 'ok' : 'warn'}`}>{a.is_public ? 'Public' : 'Admin only'}</span>
                </div>
              ))}
          </div>
        </>
      )}
      </>)}

      {adminTab === 'notifications' && (<>
      <h3 className="section-title" style={{ marginTop: 0 }}>Notifications</h3>
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="report">
          <thead>
            <tr>
              <th>Notification</th>
              <th>When</th>
              <th>Goes to</th>
              <th>Status</th>
              <th>Today</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATIONS.map((n) => {
              const job = schedule.find((j) => j.jobname === n.job)
              const run = notifRuns.filter((r) => r.type === n.type).sort((a, b) => (a.ran_at < b.ran_at ? 1 : -1))[0]
              return (
                <tr key={n.type}>
                  <td>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <BellRing size={14} style={{ color: 'var(--lime-dark)' }} /> {n.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{n.desc}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{job ? cronHuman(job.schedule) : '—'}</td>
                  <td style={{ fontSize: 13 }}>
                    {n.delivery === 'dm' ? (
                      <>
                        <div style={{ fontWeight: 600 }}>Private DM, one per person</div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                          {settings.test_mode === '1'
                            ? 'test mode: single preview to default channel instead'
                            : '{first_name} = each recipient'}
                        </div>
                      </>
                    ) : (
                      <>
                        {channelLabel(settings[`channel_${n.type}`] || settings.slack_channel_id, channels)}
                        {!settings[`channel_${n.type}`] && (
                          <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginLeft: 5 }}>(default)</span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {job ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <label className="switch" title={job.active ? 'On — click to turn off' : 'Off — click to turn on'}>
                          <input type="checkbox" checked={!!job.active} onChange={() => toggleNotifActive(n, job)} />
                          <span className="track" />
                        </label>
                        <span style={{ fontSize: 12, fontWeight: 600, color: job.active ? 'var(--green)' : 'var(--text-3)' }}>
                          {job.active ? 'On' : 'Off'}
                        </span>
                      </div>
                    ) : <span className="badge warn">Unknown</span>}
                  </td>
                  <td>
                    {run ? (
                      run.sent
                        ? <span className="badge ok" title={`Last run ${new Date(run.ran_at).toLocaleString('en-GB')}`}>Sent {new Date(run.ran_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                        : <span className="badge muted" title={`Ran ${new Date(run.ran_at).toLocaleString('en-GB')} — nothing to send / skipped`}>Ran · skipped</span>
                    ) : <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Not sent today</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn secondary"
                        style={{ padding: '5px 12px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        disabled={testing === n.type}
                        onClick={() => sendTest(n.type)}
                      >
                        <Send size={12} /> {testing === n.type ? 'Sending…' : 'Send test'}
                      </button>
                      <button className="iconbtn" title="Edit message & schedule" onClick={() => setEditNotif(n)}>
                        <Pencil size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontWeight: 600, fontSize: 13 }}>Send tests to</label>
          {channels === null ? (
            <button className="btn ghost" style={{ padding: '5px 10px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={loadChannels}>
              <RefreshCw size={13} /> Load channels
            </button>
          ) : (
            <select value={testChannel} onChange={(e) => setTestChannel(e.target.value)}>
              <option value="">Default channel ({channelLabel(settings.slack_channel_id, channels)})</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}{c.is_member ? '' : ' (bot not in channel)'}
                </option>
              ))}
            </select>
          )}
          {channelsError && <span style={{ fontSize: 12.5, color: 'var(--red)' }}>{channelsError}</span>}
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            Channel posts use each notification's own channel (set via the pencil) or the default.
            Reminders are private DMs — manual tests never DM anyone, they post a preview to the channel chosen here. Times are London time — the clocks change (BST/GMT) are handled automatically.
          </span>
        </div>
      </div>

      <h3 className="section-title">Slack settings</h3>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontWeight: 600, fontSize: 13.5 }}>Notification channel ID</label>
          <input
            type="text"
            placeholder="e.g. C0123456789"
            defaultValue={settings.slack_channel_id || ''}
            onBlur={(e) => e.target.value !== (settings.slack_channel_id || '') && saveSetting('slack_channel_id', e.target.value.trim(), 'Slack channel')}
            style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px', width: 200 }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            Weekly summaries and daily posts go here.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <FlaskConical size={16} style={{ color: settings.test_mode === '1' ? 'var(--amber)' : 'var(--text-3)' }} />
          <label style={{ fontWeight: 600, fontSize: 13.5 }}>Test mode</label>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.test_mode === '1'}
              onChange={(e) => saveSetting('test_mode', e.target.checked ? '1' : '0', 'Test mode')}
            />
            <span className="track" />
          </label>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            While on, reminder DMs are NOT sent to employees — a single test message goes to the channel above instead.
          </span>
          {settings.test_mode === '1' && <span className="badge warn">Notifications restricted to channel</span>}
        </div>
      </div>
      </>)}

      {adminTab === 'mmm' && isSuper && (<>
        <h3 className="section-title" style={{ marginTop: 0 }}>Monday Morning Meeting <span className="badge warn">Super admin</span></h3>
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>
              Up next — {parseISO(mmmMonday).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            {mmmReaderId ? (
              <div className="avatar-row" style={{ gap: 10 }}>
                <Avatar profile={profileById[mmmReaderId] || { full_name: mmmReaderName }} size={30} />
                <span style={{ fontWeight: 700, fontSize: 15 }}>{mmmReaderName}</span>
                {mmmUpcomingTurn && (
                  mmmUpcomingTurn.confirmed_at ? <span className="badge ok">confirmed</span>
                  : mmmUpcomingTurn.asked_at ? <span className="badge warn">awaiting reply</span>
                  : <span className="badge ok">assigned</span>
                )}
              </div>
            ) : <span style={{ color: 'var(--text-3)', fontSize: 13 }}>No one in the rota yet.</span>}
            {mmmFollowing && (
              <div className="avatar-row" style={{ gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--text-3)' }}>
                <span>Next week · {parseISO(mmmFollowing.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                <Avatar profile={mmmFollowing.person} size={20} />
                <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{mmmFollowing.person.full_name}</span>
                {mmmFollowing.assigned && <span className="badge ok">assigned</span>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <select value="" onChange={(e) => { if (e.target.value) setMmmReader(e.target.value) }}
                style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '6px 10px' }}>
                <option value="">Reassign this Monday…</option>
                {mmmRota.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Overrides who reads on {parseISO(mmmMonday).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}; the rota then continues alphabetically from them.</span>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              {
                key: 'reminder', title: 'Monday 8 AM reminder', settingKey: 'template_mmm', label: 'MMM reminder',
                placeholder: '🎤 Hi {first_name}! It\'s your turn to share a quote at today\'s Monday Morning Meeting…',
                onTest: sendMmmTest,
                help: <><code>{'{first_name}'}</code> is filled in. DM'd to whoever's up, every Monday at 8 AM London.</>,
              },
              {
                key: 'confirm', title: 'Confirmation request (Tue 11 AM)', settingKey: 'template_mmm_confirm', label: 'MMM confirmation request',
                placeholder: '🎤 Hi {first_name}! You\'re up to share an inspiring quote at the Monday Morning Meeting on {date}. Can you make it?',
                onTest: sendMmmConfirmTest,
                help: <><code>{'{first_name}'}</code> and <code>{'{date}'}</code> are filled in. DM'd to next Monday's reader after this week's meeting — they confirm with a button, or delay their turn a few weeks (the next person is then asked automatically).</>,
              },
            ].map((m) => {
              const open = mmmMsgOpen === m.key
              const current = (settings[m.settingKey] || '').trim()
              return (
                <div key={m.key} style={{ flex: '1 1 300px', minWidth: 260, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                  <button
                    onClick={() => setMmmMsgOpen(open ? null : m.key)}
                    aria-expanded={open}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}
                  >
                    <ChevronRight size={14} style={{ color: 'var(--text-3)', flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{m.title}</span>
                    {!open && <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{current || 'default message'}</span>}
                  </button>
                  {open && (
                    <div style={{ marginTop: 10 }}>
                      <input type="text" defaultValue={settings[m.settingKey] || ''}
                        placeholder={m.placeholder}
                        maxLength={300}
                        onBlur={(e) => e.target.value !== (settings[m.settingKey] || '') && saveSetting(m.settingKey, e.target.value, m.label)}
                        style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px', width: '100%' }} />
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                        <button className="btn secondary" style={{ padding: '6px 12px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={m.onTest}>
                          <Send size={13} /> Send test to channel
                        </button>
                        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{m.help}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <h3 className="section-title">Rota order ({mmmRota.length})</h3>
        <div style={{ fontSize: 12, color: 'var(--text-3)', margin: '-6px 0 8px' }}>Drag the ⠿ handle to reorder. The rotation follows this order and wraps around.</div>
        <div className="card" style={{ padding: '6px 0' }}>
          {mmmRota.map((p, i) => (
            <div
              key={p.id}
              className="avatar-row"
              draggable
              onDragStart={() => setMmmDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onMmmDrop(i) }}
              onDragEnd={() => setMmmDragIdx(null)}
              style={{ padding: '8px 16px', gap: 10, opacity: mmmDragIdx === i ? 0.4 : 1, background: mmmDragIdx === i ? 'var(--surface-2)' : undefined }}
            >
              <span title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--text-3)', display: 'inline-flex' }}><GripVertical size={15} /></span>
              <span style={{ width: 24, color: 'var(--text-3)', fontWeight: 700, fontSize: 12.5 }}>{i + 1}.</span>
              <Avatar profile={p} size={24} />
              <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{p.full_name}</span>
              {p.id === mmmReaderId && <span className="badge ok">up next</span>}
              <button className="row-remove" title="Remove from rota" onClick={() => toggleMmmExcluded(p)}><X size={14} /></button>
            </div>
          ))}
          {mmmRota.length === 0 && <div style={{ padding: '10px 16px', color: 'var(--text-3)', fontSize: 13 }}>No one in the rota.</div>}
        </div>

        {mmmExcluded.length > 0 && (<>
          <h3 className="section-title">Not in the rota ({mmmExcluded.length})</h3>
          <div className="card" style={{ padding: '6px 0' }}>
            {mmmExcluded.map((p) => (
              <div key={p.id} className="avatar-row" style={{ padding: '8px 16px', gap: 10 }}>
                <Avatar profile={p} size={24} />
                <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{p.full_name}</span>
                <button className="btn secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => toggleMmmExcluded(p)}>Add to rota</button>
              </div>
            ))}
          </div>
        </>)}

        {mmmTurns.length > 0 && (<>
          <h3 className="section-title">Meetings</h3>
          <div className="card" style={{ padding: '6px 0' }}>
            {mmmTurns.map((t) => (
              <div key={t.meeting_date} style={{ padding: '10px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, minWidth: 120 }}>{parseISO(t.meeting_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{t.reader_name}</span>
                  {t.delayed_booking && <span className="badge muted">rescheduled</span>}
                  {t.meeting_date > toISODate(today) ? (
                    t.confirmed_at ? <span className="badge ok">confirmed</span>
                    : t.asked_at ? <span className="badge warn">awaiting reply</span>
                    : <span className="badge muted">upcoming</span>
                  ) : (
                    t.reminded_at ? <span className="badge ok">reminded</span> : <span className="badge warn">not sent</span>
                  )}
                </div>
                {t.quote && <div style={{ fontStyle: 'italic', color: 'var(--text-2)', fontSize: 13, marginTop: 6 }}>“{t.quote}”</div>}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>Quotes and transcripts will appear here once the meeting webhook is connected.</div>
        </>)}
      </>)}

      {editNotif && (
        <NotificationModal
          notif={editNotif}
          job={schedule.find((j) => j.jobname === editNotif.job)}
          settings={settings}
          channels={channels}
          onClose={() => setEditNotif(null)}
          onSaved={load}
          showToast={showToast}
        />
      )}
    </div>
  )
}
