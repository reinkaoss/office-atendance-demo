import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Check, Plus, Minus, Users, X, Sparkles, Trash2, Palmtree, LayoutGrid, Rows3, Ban, CalendarCheck, MessageSquare } from 'lucide-react'
import {
  supabase, startOfWeek, addDays, toISODate, weekDays, fmtRange, fmtDay, isToday,
} from '../lib/supabase'
import Avatar from './Avatar'

const MONTH_WEEKS = 5
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const WEEKDAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' }
const DAY_PARTS = [
  { value: 'full', label: 'Full day' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'event', label: 'At an event' },
]
const PART_TAG = { morning: 'AM', afternoon: 'PM', event: 'Event' } // full = no tag
const parseDays = (s) => (s || '').split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= 5)

export default function WeekCalendar({ me, profile, isAdmin, showToast }) {
  const [anchor, setAnchor] = useState(() => startOfWeek()) // first visible Monday
  const [view, setView] = useState('month') // 'month' | 'week'
  const [rows, setRows] = useState([])
  const [holidayRows, setHolidayRows] = useState([])
  const [absenceRows, setAbsenceRows] = useState([]) // declared "not in" (own + public)
  const [events, setEvents] = useState([])
  const [groups, setGroups] = useState([]) // office_groups (assigned-day groups)
  const [closures, setClosures] = useState([]) // office closed days
  const [capacity, setCapacity] = useState(0) // desk capacity (0 = unlimited)
  const [allProfiles, setAllProfiles] = useState([]) // for admin "add someone"
  const [weeksInLast4, setWeeksInLast4] = useState(null) // personal stat
  const [usualDays, setUsualDays] = useState(() => parseDays(profile?.default_days))
  const [selected, setSelected] = useState(null) // ISO date of expanded day
  const [feedbackOpen, setFeedbackOpen] = useState(false) // questions/issues/bugs modal
  const [fbCategory, setFbCategory] = useState('question')
  const [fbMessage, setFbMessage] = useState('')
  const [fbSending, setFbSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newEvent, setNewEvent] = useState('')
  const [closeReason, setCloseReason] = useState('') // admin: reason when closing a day
  const [tip, setTip] = useState(null) // { name, x, y } hover tooltip
  const [absenceModal, setAbsenceModal] = useState(null) // { iso, reason, adminOnly, isPublic, existing }
  const [confirmBooking, setConfirmBooking] = useState(null) // iso awaiting non-assigned-day acknowledgement

  const showTip = (name, e) => setTip({ name, x: e.clientX, y: e.clientY })
  const hideTip = () => setTip(null)

  // keep the Usual-days control in sync with the saved profile value (which loads async)
  useEffect(() => { setUsualDays(parseDays(profile?.default_days)) }, [profile?.default_days])

  const weeksShown = view === 'week' ? 1 : MONTH_WEEKS
  const maxAv = view === 'week' ? 12 : 5 // show more attendees in the roomier week view

  const weeks = useMemo(
    () => Array.from({ length: weeksShown }, (_, i) => addDays(anchor, i * 7)),
    [anchor, weeksShown]
  )
  const fromISO = toISODate(anchor)
  const endISO = toISODate(addDays(anchor, weeksShown * 7 - 3)) // last Friday

  const load = useCallback(async () => {
    const [att, hol, abs, ev, grp, clo, cap] = await Promise.all([
      supabase
        .from('attendance')
        .select('id, user_id, date, confirmed, day_part, profiles ( id, full_name, avatar_url )')
        .gte('date', fromISO)
        .lte('date', endISO),
      supabase
        .from('holidays')
        .select('id, user_id, date, profiles ( id, full_name, avatar_url )')
        .gte('date', fromISO)
        .lte('date', endISO),
      supabase
        .from('absences')
        .select('id, user_id, date, is_public, reason_admin_only, reason, profiles:user_id ( id, full_name, avatar_url )')
        .gte('date', fromISO)
        .lte('date', endISO),
      supabase
        .from('office_events')
        .select('id, date, title')
        .gte('date', fromISO)
        .lte('date', endISO),
      supabase.from('office_groups').select('grp, label, days'),
      supabase.from('office_closures').select('date, label').gte('date', fromISO).lte('date', endISO),
      supabase.from('app_settings').select('value').eq('key', 'desk_capacity').maybeSingle(),
    ])
    if (!att.error) setRows(att.data || [])
    if (!hol.error) setHolidayRows(hol.data || [])
    if (!abs.error) setAbsenceRows(abs.data || [])
    if (!ev.error) setEvents(ev.data || [])
    if (!grp.error) setGroups(grp.data || [])
    if (!clo.error) setClosures(clo.data || [])
    setCapacity(Number(cap.data?.value) || 0)
    setLoading(false)
  }, [fromISO, endISO])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // personal stat: how many of the last 4 weeks the user came in (≥1 day)
  useEffect(() => {
    const start = startOfWeek(addDays(new Date(), -21))
    const end = addDays(startOfWeek(), 4)
    supabase
      .from('attendance')
      .select('date')
      .eq('user_id', me.id)
      .gte('date', toISODate(start))
      .lte('date', toISODate(end))
      .then(({ data }) => {
        const weeks = new Set((data || []).map((r) => toISODate(startOfWeek(new Date(r.date + 'T00:00:00')))))
        setWeeksInLast4(weeks.size)
      })
    if (isAdmin) {
      supabase.from('profiles').select('id, full_name, avatar_url').order('full_name').then(({ data }) => setAllProfiles(data || []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id, isAdmin])

  // Esc closes the drawer / any open modal
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setConfirmBooking((c) => (c ? null : c))
      setAbsenceModal((m) => (m ? null : m))
      setSelected((s) => (s ? null : s))
      setFeedbackOpen((o) => (o ? false : o))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const ch = supabase
      .channel('attendance-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'office_events' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [load])

  const eventsByDate = useMemo(() => {
    const m = {}
    for (const e of events) (m[e.date] ||= []).push(e)
    return m
  }, [events])

  const addEvent = async (iso) => {
    const title = newEvent.trim()
    if (!title) return
    setNewEvent('')
    const { error } = await supabase.from('office_events').insert({ date: iso, title, created_by: me.id })
    if (error) showToast('Could not add event')
    else { showToast('Event added'); load() }
  }

  const deleteEvent = async (id) => {
    const { error } = await supabase.from('office_events').delete().eq('id', id)
    if (error) showToast('Could not remove event')
    else load()
  }

  // admin: close the office for a day — no one can book it, existing bookings are removed,
  // and the Slack bot posts a closure notice that morning. Reopen with reopenOffice.
  const closeOffice = async (iso) => {
    const label = closeReason.trim()
    const { error } = await supabase.from('office_closures').upsert({ date: iso, label }, { onConflict: 'date' })
    if (error) { showToast('Could not close the office'); return }
    const { data: removed } = await supabase.from('attendance').delete().eq('date', iso).select('id')
    const n = removed?.length || 0
    setCloseReason('')
    showToast(n ? `Office closed — removed ${n} booking${n === 1 ? '' : 's'}` : 'Office closed')
    load()
  }

  const reopenOffice = async (iso) => {
    const { error } = await supabase.from('office_closures').delete().eq('date', iso)
    if (error) showToast('Could not reopen the office')
    else { showToast('Office reopened'); load() }
  }

  const byDate = useMemo(() => {
    const m = {}
    const seen = new Set()
    for (const r of rows) {
      const k = `${r.user_id}|${r.date}`
      if (seen.has(k)) continue // defensive de-dupe (optimistic rows, HMR ghosts)
      seen.add(k)
      ;(m[r.date] ||= []).push(r)
    }
    for (const k in m)
      m[k].sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
    return m
  }, [rows])

  const mine = useMemo(
    () => new Set(rows.filter((r) => r.user_id === me.id).map((r) => r.date)),
    [rows, me.id]
  )

  const holidaysByDate = useMemo(() => {
    const m = {}
    const seen = new Set()
    for (const h of holidayRows) {
      const k = `${h.user_id}|${h.date}`
      if (seen.has(k)) continue
      seen.add(k)
      ;(m[h.date] ||= []).push(h)
    }
    for (const k in m)
      m[k].sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
    return m
  }, [holidayRows])

  const myHols = useMemo(
    () => new Set(holidayRows.filter((h) => h.user_id === me.id).map((h) => h.date)),
    [holidayRows, me.id]
  )

  // declared "not in" — by date (own + others I'm allowed to see) and my own keyed by date
  const absencesByDate = useMemo(() => {
    const m = {}
    const seen = new Set()
    for (const a of absenceRows) {
      const k = `${a.user_id}|${a.date}`
      if (seen.has(k)) continue
      seen.add(k)
      ;(m[a.date] ||= []).push(a)
    }
    for (const k in m) m[k].sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
    return m
  }, [absenceRows])
  const myAbsence = useMemo(() => {
    const m = {}
    for (const a of absenceRows) if (a.user_id === me.id) m[a.date] = a
    return m
  }, [absenceRows, me.id])

  const closureByDate = useMemo(() => {
    const m = {}
    for (const c of closures) m[c.date] = c.label || 'Office closed'
    return m
  }, [closures])
  const countOn = (iso) => (byDate[iso] || []).length

  const openAbsence = (iso) => {
    const ex = myAbsence[iso]
    setAbsenceModal({
      iso,
      reason: ex?.reason || '',
      adminOnly: ex ? ex.reason_admin_only : true,
      isPublic: ex ? ex.is_public : false,
      existing: !!ex,
    })
  }

  const saveAbsence = async () => {
    const { iso, reason, adminOnly, isPublic } = absenceModal
    setAbsenceModal(null)
    // can't be "in" and "not in" the same day
    if (mine.has(iso)) {
      setRows((prev) => prev.filter((r) => !(r.user_id === me.id && r.date === iso)))
      await supabase.from('attendance').delete().eq('user_id', me.id).eq('date', iso)
    }
    const { error } = await supabase
      .from('absences')
      .upsert(
        { user_id: me.id, date: iso, reason: reason.trim(), reason_admin_only: adminOnly, is_public: isPublic },
        { onConflict: 'user_id,date' }
      )
    if (error) showToast('Could not save — try again')
    else showToast('Marked as not in')
    load()
  }

  const removeAbsence = async (iso) => {
    setAbsenceModal(null)
    setAbsenceRows((prev) => prev.filter((a) => !(a.user_id === me.id && a.date === iso)))
    const { error } = await supabase.from('absences').delete().eq('user_id', me.id).eq('date', iso)
    if (error) showToast('Could not update — try again')
    else showToast('Cleared')
    load()
  }

  // the current user's assigned office day(s), via their group
  const assignedDays = useMemo(() => {
    const g = groups.find((x) => x.grp === profile?.office_group)
    return g ? parseDays(g.days) : []
  }, [groups, profile?.office_group])
  const assignedDaySet = useMemo(() => new Set(assignedDays), [assignedDays])
  const assignedLabel = assignedDays.map((n) => WEEKDAY_NAMES[n]).join(' & ')

  // weekday number (1=Mon … 5=Fri) for an ISO date
  const weekdayOf = (iso) => ((new Date(iso + 'T00:00:00').getDay() + 6) % 7) + 1

  // marking yourself in: block closed/full days, warn on non-assigned days
  const toggle = (iso) => {
    if (!mine.has(iso)) {
      if (closureByDate[iso]) { showToast(`Office closed${closureByDate[iso] !== 'Office closed' ? ` — ${closureByDate[iso]}` : ''}`); return }
      if (capacity && countOn(iso) >= capacity) { showToast(`That day is full (${capacity}/${capacity} desks)`); return }
      if (assignedDaySet.size > 0 && !assignedDaySet.has(weekdayOf(iso))) { setConfirmBooking(iso); return }
    }
    performToggle(iso)
  }

  const performToggle = async (iso) => {
    const on = mine.has(iso)
    const wasHoliday = myHols.has(iso)
    // marking yourself in clears any holiday on that day (mutually exclusive)
    setRows((prev) =>
      on
        ? prev.filter((r) => !(r.user_id === me.id && r.date === iso))
        : [...prev, { id: `tmp-${iso}`, user_id: me.id, date: iso, day_part: 'full', confirmed: false, profiles: null }]
    )
    if (!on && wasHoliday) setHolidayRows((prev) => prev.filter((h) => !(h.user_id === me.id && h.date === iso)))
    if (!on && wasHoliday) await supabase.from('holidays').delete().eq('user_id', me.id).eq('date', iso)
    if (!on && myAbsence[iso]) {
      setAbsenceRows((prev) => prev.filter((a) => !(a.user_id === me.id && a.date === iso)))
      await supabase.from('absences').delete().eq('user_id', me.id).eq('date', iso)
    }
    const { error } = on
      ? await supabase.from('attendance').delete().eq('user_id', me.id).eq('date', iso)
      : await supabase.from('attendance').insert({ user_id: me.id, date: iso })
    if (error) showToast('Could not save — try again')
    load()
  }

  const toggleHoliday = async (iso) => {
    const on = myHols.has(iso)
    const wasInOffice = mine.has(iso)
    setHolidayRows((prev) =>
      on
        ? prev.filter((h) => !(h.user_id === me.id && h.date === iso))
        : [...prev, { id: `tmp-${iso}`, user_id: me.id, date: iso, profiles: null }]
    )
    // going on holiday clears any office day or declared absence on that date
    if (!on && wasInOffice) setRows((prev) => prev.filter((r) => !(r.user_id === me.id && r.date === iso)))
    if (!on && wasInOffice) await supabase.from('attendance').delete().eq('user_id', me.id).eq('date', iso)
    if (!on && myAbsence[iso]) {
      setAbsenceRows((prev) => prev.filter((a) => !(a.user_id === me.id && a.date === iso)))
      await supabase.from('absences').delete().eq('user_id', me.id).eq('date', iso)
    }
    const { error } = on
      ? await supabase.from('holidays').delete().eq('user_id', me.id).eq('date', iso)
      : await supabase.from('holidays').insert({ user_id: me.id, date: iso })
    if (error) showToast('Could not save — try again')
    load()
  }

  const saveUsualDays = async (days) => {
    setUsualDays(days)
    const { error } = await supabase.from('profiles').update({ default_days: days.join(',') }).eq('id', me.id)
    if (error) showToast('Could not save usual days')
  }

  // pre-fill the user's usual days across the visible (future) weeks
  const prefillUsual = async () => {
    if (!usualDays.length) return
    const toInsert = []
    for (const mon of weeks) {
      for (const d of weekDays(mon)) {
        const iso = toISODate(d)
        if (!usualDays.includes(weekdayOf(iso))) continue
        if (isPast(d) || closureByDate[iso]) continue
        if (mine.has(iso) || myHols.has(iso) || myAbsence[iso]) continue
        if (capacity && countOn(iso) >= capacity) continue
        toInsert.push({ user_id: me.id, date: iso })
      }
    }
    if (!toInsert.length) { showToast('Your usual days are already set for these weeks'); return }
    const { error } = await supabase.from('attendance').insert(toInsert)
    if (error) showToast('Could not pre-fill — try again')
    else showToast(`Added ${toInsert.length} day${toInsert.length === 1 ? '' : 's'}`)
    load()
  }

  // set the part of the day for the current user's existing booking
  const setDayPart = async (iso, part) => {
    setRows((prev) => prev.map((r) => (r.user_id === me.id && r.date === iso ? { ...r, day_part: part } : r)))
    const { error } = await supabase.from('attendance').update({ day_part: part }).eq('user_id', me.id).eq('date', iso)
    if (error) showToast('Could not update — try again')
    load()
  }

  // admin: mark another person in / out for a day
  const adminSetAttendance = async (userId, iso, on) => {
    const { error } = on
      ? await supabase.from('attendance').delete().eq('user_id', userId).eq('date', iso)
      : await supabase.from('attendance').insert({ user_id: userId, date: iso })
    if (error) showToast('Could not update — try again')
    load()
  }

  // mark / clear the whole working week (Mon–Fri) as holiday for the current user
  const setWeekHoliday = async (weekMon, on) => {
    const isoDays = weekDays(weekMon).map(toISODate)
    if (on) {
      setHolidayRows((prev) => [
        ...prev.filter((h) => !(h.user_id === me.id && isoDays.includes(h.date))),
        ...isoDays.map((d) => ({ id: `tmp-${d}`, user_id: me.id, date: d, profiles: null })),
      ])
      setRows((prev) => prev.filter((r) => !(r.user_id === me.id && isoDays.includes(r.date))))
      await supabase.from('attendance').delete().eq('user_id', me.id).in('date', isoDays)
      const { error } = await supabase
        .from('holidays')
        .upsert(isoDays.map((d) => ({ user_id: me.id, date: d })), { onConflict: 'user_id,date' })
      if (error) showToast('Could not save holiday — try again')
      else showToast('Marked on holiday all week')
    } else {
      setHolidayRows((prev) => prev.filter((h) => !(h.user_id === me.id && isoDays.includes(h.date))))
      const { error } = await supabase.from('holidays').delete().eq('user_id', me.id).in('date', isoDays)
      if (error) showToast('Could not update — try again')
      else showToast('Holiday cleared')
    }
    load()
  }

  const isPast = (d) => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return d < t
  }

  const submitFeedback = async () => {
    const msg = fbMessage.trim()
    if (!msg) { showToast('Please type your message first'); return }
    setFbSending(true)
    const { error } = await supabase.from('feedback').insert({
      user_id: me.id,
      category: fbCategory,
      message: msg,
      page: 'calendar',
    })
    setFbSending(false)
    if (error) { showToast('Could not send — please try again'); return }
    showToast('✓ Thanks! Your message has been sent.')
    setFbMessage('')
    setFbCategory('question')
    setFeedbackOpen(false)
  }

  return (
    <div>
      <div className="cal-topinfo">
        {profile?.office_group && assignedLabel && (
          <span className="info-chip assigned"><CalendarCheck size={14} /> Assigned day{assignedDays.length > 1 ? 's' : ''}: <strong>{assignedLabel}</strong></span>
        )}
        {weeksInLast4 != null && (
          <span className="info-chip"><Check size={14} /> In <strong>{weeksInLast4}</strong> of the last 4 weeks</span>
        )}
        <span className="spacer" />
        <span className="usual-control">
          <span className="usual-label">Usual days</span>
          <span className="usual-days-group">
            {DOW.map((lbl, i) => {
              const dow = i + 1
              const on = usualDays.includes(dow)
              return (
                <button
                  key={dow}
                  className={`usual-day ${on ? 'on' : ''}`}
                  title={`${on ? 'Remove' : 'Set'} ${WEEKDAY_NAMES[dow]} as a usual day`}
                  onClick={() => saveUsualDays(on ? usualDays.filter((x) => x !== dow) : [...usualDays, dow].sort())}
                >
                  {lbl}
                </button>
              )
            })}
          </span>
          {usualDays.length > 0 && (
            <button className="btn ghost usual-prefill" onClick={prefillUsual} title="Add your usual days to the weeks shown">
              Pre-fill
            </button>
          )}
        </span>
      </div>
      <div className="weeknav">
        <button className="iconbtn" onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Earlier">
          <ChevronLeft size={17} />
        </button>
        <button className="iconbtn" onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Later">
          <ChevronRight size={17} />
        </button>
        <div>
          <h2>{view === 'week'
            ? fmtRange(anchor)
            : `${fmtRange(anchor).split('–')[0].trim()} → ${fmtRange(weeks[weeksShown - 1]).split('–')[1].trim()}`}</h2>
          <div className="sub">Days are greyed out (not in) until you tap <Plus size={11} strokeWidth={2.5} style={{ verticalAlign: '-1px' }} /> to mark yourself in · green ring = confirmed via the Slack check-in</div>
        </div>
        <div className="spacer" />
        <div className="viewtoggle" role="group" aria-label="Calendar view">
          <button
            className={`viewtoggle-btn ${view === 'month' ? 'active' : ''}`}
            onClick={() => setView('month')}
            title="Month view"
            aria-pressed={view === 'month'}
          >
            <LayoutGrid size={15} /> Month
          </button>
          <button
            className={`viewtoggle-btn ${view === 'week' ? 'active' : ''}`}
            onClick={() => setView('week')}
            title="Week view"
            aria-pressed={view === 'week'}
          >
            <Rows3 size={15} /> Week
          </button>
        </div>
        <button className="btn secondary" onClick={() => { setAnchor(startOfWeek()); setSelected(null) }}>
          Today
        </button>
      </div>

      <div className={`mcal card ${view === 'week' ? 'weekview' : ''}`}>
        <div className="mcal-head">
          {DOW.map((d) => <div key={d} className="mcal-dow">{d}</div>)}
          <div className="mcal-dow week">Week</div>
        </div>

        {weeks.map((mon) => {
          const weekISO = toISODate(mon)
          const days = weekDays(mon)
          const weekPast = isPast(addDays(mon, 4))
          const myDays = days.filter((d) => mine.has(toISODate(d))).length
          const allWeekHoliday = days.every((d) => myHols.has(toISODate(d)))
          return (
            <div key={weekISO}>
            <div className="mcal-row">
              {days.map((d) => {
                const iso = toISODate(d)
                const people = byDate[iso] || []
                const offPeople = holidaysByDate[iso] || []
                const notInPeople = absencesByDate[iso] || []
                const on = mine.has(iso)
                const iAmOff = myHols.has(iso)
                const iAmNotIn = !!myAbsence[iso]
                const open = selected === iso
                const past = isPast(d)
                const closed = closureByDate[iso]
                const full = capacity && people.length >= capacity
                return (
                  <div
                    key={iso}
                    className={`mcal-cell ${isToday(d) ? 'today' : ''} ${open ? 'open' : ''} ${past ? 'past' : ''} ${closed ? 'closed' : on ? 'me-in' : iAmOff ? 'me-holiday' : iAmNotIn ? 'me-absent' : 'me-out'}`}
                    onClick={() => setSelected(open ? null : iso)}
                  >
                    <div className="mcal-celltop">
                      <span className="mcal-date">
                        <span className="mcal-celldow">{fmtDay(d)}</span>
                        {d.getDate() === 1 || (iso === fromISO) ? (
                          <span className="mcal-month">{d.toLocaleDateString('en-GB', { month: 'short' })} </span>
                        ) : null}
                        {d.getDate()}
                        {isToday(d) && <span className="mcal-todaydot" />}
                      </span>
                      {!past && !closed && (
                        <button
                          className={`mcal-quick ${on ? 'on' : ''}`}
                          onClick={(e) => { e.stopPropagation(); toggle(iso) }}
                          title={on ? "Remove me" : iAmOff ? "Mark me in (cancels holiday)" : "Mark me in"}
                        >
                          {on ? <Check size={13} strokeWidth={3} /> : <Plus size={13} strokeWidth={2.5} />}
                        </button>
                      )}
                    </div>

                    {closed && (
                      <span className="mcal-closed-pill" title={closed}><Ban size={11} /> {closed}</span>
                    )}
                    {iAmOff && (
                      <span className="mcal-holiday-pill"><Palmtree size={11} /> On holiday</span>
                    )}
                    {iAmNotIn && !iAmOff && (
                      <span className="mcal-notin-pill"><Ban size={11} /> Not in</span>
                    )}
                    {(eventsByDate[iso] || []).slice(0, 2).map((ev) => (
                      <span key={ev.id} className="mcal-event" title={ev.title}>
                        <Sparkles size={10} /> {ev.title}
                      </span>
                    ))}
                    <div className="mcal-people">
                      {people.slice(0, maxAv).map((p) => {
                        const prof = p.profiles || { id: p.user_id, full_name: 'You' }
                        return (
                          <Avatar
                            key={p.id} profile={prof} size={view === 'week' ? 28 : 22}
                            confirmed={p.confirmed}
                            onMouseEnter={(e) => showTip(prof.full_name + (p.confirmed ? ' · confirmed in' : ''), e)}
                            onMouseMove={(e) => showTip(prof.full_name + (p.confirmed ? ' · confirmed in' : ''), e)}
                            onMouseLeave={hideTip}
                          />
                        )
                      })}
                      {people.length > maxAv && <span className="mcal-more">+{people.length - maxAv}</span>}
                      {people.length === 0 && !loading && !closed && <span className="mcal-empty">—</span>}
                    </div>
                    {!closed && (capacity > 0 || offPeople.length > 0 || notInPeople.length > 0) && (
                      <span className="mcal-offcount">
                        {capacity > 0 && (
                          <span className={`mcal-cap ${full ? 'full' : people.length >= capacity * 0.9 ? 'nearfull' : ''}`}>
                            {people.length}/{capacity}
                          </span>
                        )}
                        {capacity > 0 && (offPeople.length > 0 || notInPeople.length > 0) && ' · '}
                        {offPeople.length > 0 && <><Palmtree size={10} /> {offPeople.length}</>}
                        {offPeople.length > 0 && notInPeople.length > 0 && ' · '}
                        {notInPeople.length > 0 && <>{notInPeople.length} out</>}
                      </span>
                    )}
                  </div>
                )
              })}

              <div className={`mcal-weekcell ${myDays > 0 ? 'ok' : ''} ${allWeekHoliday ? 'hol' : ''}`}>
                <div className="mcal-weeklabel">w/c {mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                <div className="mcal-weekdays">
                  {allWeekHoliday
                    ? <span className="mcal-weekhol"><Palmtree size={11} /> On holiday all week</span>
                    : myDays > 0
                      ? `${myDays} day${myDays === 1 ? '' : 's'} in`
                      : <span className="mcal-weekout">Not in this week</span>}
                </div>
                {!weekPast && (
                  <button className="mcal-weeklink" onClick={() => setWeekHoliday(mon, !allWeekHoliday)}>
                    <Palmtree size={11} /> {allWeekHoliday ? 'Cancel holiday' : 'Holiday all week'}
                  </button>
                )}
              </div>
            </div>

            </div>
          )
        })}
      </div>

      <div className="cal-legend">
        <span><span className="lg lg-in" /> You’re in</span>
        <span><span className="lg lg-confirmed" /> Confirmed in</span>
        <span><span className="lg lg-out" /> Not in</span>
        <span><span className="lg lg-holiday" /> Holiday</span>
        <span><span className="lg lg-absent" /> Declared not-in</span>
        <span><span className="lg lg-closed" /> Office closed</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
        <button
          className="btn secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}
          onClick={() => setFeedbackOpen(true)}
        >
          <MessageSquare size={15} /> Question, issue or idea?
        </button>
      </div>

      {feedbackOpen && (
        <div className="modal-overlay" onClick={() => setFeedbackOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <MessageSquare size={16} style={{ color: 'var(--lime-dark)' }} />
              <h3>Send us a message</h3>
              <div className="spacer" />
              <button className="iconbtn" onClick={() => setFeedbackOpen(false)} aria-label="Close"><X size={15} /></button>
            </div>
            <p className="modal-sub">Questions, bugs, or ideas — it goes straight to the team running this.</p>

            <div className="modal-label">What's this about?</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {[
                { v: 'question', l: 'Question' },
                { v: 'bug', l: 'Something broke' },
                { v: 'idea', l: 'Idea / request' },
                { v: 'other', l: 'Other' },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setFbCategory(o.v)}
                  className={`btn ${fbCategory === o.v ? '' : 'secondary'}`}
                  style={{ padding: '6px 12px', fontSize: 13 }}
                >
                  {o.l}
                </button>
              ))}
            </div>

            <div className="modal-label">Your message</div>
            <textarea
              value={fbMessage}
              onChange={(e) => setFbMessage(e.target.value)}
              maxLength={5000}
              autoFocus
              rows={5}
              placeholder="Tell us what's up…"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', resize: 'vertical', fontSize: 14 }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn secondary" onClick={() => setFeedbackOpen(false)}>Cancel</button>
              <button className="btn" disabled={fbSending || !fbMessage.trim()} onClick={submitFeedback}>
                {fbSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (() => {
        const iso = selected
        const selDate = new Date(iso + 'T00:00:00')
        const people = byDate[iso] || []
        const offPeople = holidaysByDate[iso] || []
        const notInPeople = absencesByDate[iso] || []
        const dayEvents = eventsByDate[iso] || []
        const on = mine.has(iso)
        const myPart = (people.find((p) => p.user_id === me.id) || {}).day_part || 'full'
        const iAmOff = myHols.has(iso)
        const iAmNotIn = !!myAbsence[iso]
        const past = isPast(selDate)
        const closed = closureByDate[iso]
        const inIds = new Set(people.map((p) => p.user_id))
        return (
          <div className="drawer-overlay" onClick={() => setSelected(null)}>
            <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-head">
                <div style={{ minWidth: 0 }}>
                  <div className="drawer-title">{selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                  <div className="mcal-detailcount" style={{ marginTop: 4 }}>
                    <Users size={13} /> {people.length}{capacity > 0 ? ` / ${capacity}` : ''} in office
                    {capacity > 0 && people.length >= capacity && <span className="badge warn" style={{ marginLeft: 8 }}>Full</span>}
                    {capacity > 0 && people.length >= capacity * 0.9 && people.length < capacity && <span className="badge warn" style={{ marginLeft: 8 }}>Nearly full</span>}
                  </div>
                </div>
                <div className="spacer" />
                <button className="iconbtn" onClick={() => setSelected(null)} aria-label="Close"><X size={16} /></button>
              </div>
              <div className="drawer-body">
                {closed && (
                  <div className="drawer-closed"><Ban size={14} /> Office closed{closed !== 'Office closed' ? ` — ${closed}` : ''}</div>
                )}
                {closed && isAdmin && !past && (
                  <button className="btn secondary mcal-bigtoggle" style={{ marginBottom: 12 }} onClick={() => reopenOffice(iso)}>
                    <CalendarCheck size={14} /> Reopen the office
                  </button>
                )}
                {!past && !closed && (
                  <div className="drawer-actions">
                    <button className={`btn mcal-bigtoggle ${on ? 'secondary' : ''}`} onClick={() => toggle(iso)}>
                      {on ? <><Minus size={14} /> Remove me</> : <><Plus size={14} /> Mark me in</>}
                    </button>
                    <button className={`btn mcal-bigtoggle holiday ${iAmOff ? 'on' : 'secondary'}`} onClick={() => toggleHoliday(iso)}>
                      <Palmtree size={14} /> {iAmOff ? 'Cancel holiday' : 'On holiday'}
                    </button>
                    {!iAmOff && (
                      <button className={`btn mcal-bigtoggle notin ${iAmNotIn ? 'on' : 'secondary'}`} onClick={() => openAbsence(iso)}>
                        <Ban size={14} /> {iAmNotIn ? 'Edit not-in' : 'Not coming in'}
                      </button>
                    )}
                  </div>
                )}
                {on && !past && !closed && (
                  <div className="daypart">
                    <span className="drawer-sectionlabel">How long are you in?</span>
                    <div className="daypart-chips">
                      {DAY_PARTS.map((p) => (
                        <button
                          key={p.value}
                          className={`daypart-chip ${myPart === p.value ? 'on' : ''}`}
                          onClick={() => setDayPart(iso, p.value)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(dayEvents.length > 0 || isAdmin) && (
                  <div className="mcal-events">
                    {dayEvents.map((ev) => (
                      <span key={ev.id} className="mcal-event big">
                        <Sparkles size={12} /> {ev.title}
                        {isAdmin && (
                          <button className="mcal-eventdel" onClick={() => deleteEvent(ev.id)} title="Remove event">
                            <Trash2 size={11} />
                          </button>
                        )}
                      </span>
                    ))}
                    {isAdmin && !past && (
                      <span className="mcal-addevent">
                        <input
                          type="text"
                          placeholder="Add an event (e.g. Team lunch 🍕)"
                          value={newEvent}
                          maxLength={120}
                          onChange={(e) => setNewEvent(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && addEvent(iso)}
                        />
                        <button className="btn" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => addEvent(iso)} disabled={!newEvent.trim()}>
                          Add
                        </button>
                      </span>
                    )}
                  </div>
                )}
                <div className="drawer-sectionlabel"><Users size={13} /> In the office</div>
                {people.length === 0 ? (
                  <div className="mcal-empty" style={{ padding: '4px 0 8px' }}>No one yet — be the first.</div>
                ) : (
                  <div className="mcal-names drawer-list">
                    {people.map((p) => (
                      <div className={`avatar-row ${p.confirmed ? 'confirmed' : ''}`} key={p.id}>
                        <Avatar profile={p.profiles || { id: p.user_id, full_name: 'You' }} size={24} confirmed={p.confirmed} />
                        <span className="label">{p.profiles?.full_name || 'You'}</span>
                        {PART_TAG[p.day_part] && <span className="part-tag">{PART_TAG[p.day_part]}</span>}
                        {p.confirmed && <span className="confirmed-tag"><Check size={11} strokeWidth={3} /> in</span>}
                        {isAdmin && !past && p.user_id !== me.id && (
                          <button className="row-remove" title="Remove from this day" onClick={() => adminSetAttendance(p.user_id, iso, true)}>
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {isAdmin && !past && !closed && (
                  <div className="drawer-adminadd">
                    <span className="drawer-sectionlabel">Add someone (admin)</span>
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) adminSetAttendance(e.target.value, iso, false) }}
                      disabled={capacity > 0 && people.length >= capacity}
                    >
                      <option value="">{capacity > 0 && people.length >= capacity ? 'Day is full' : 'Mark someone in…'}</option>
                      {allProfiles.filter((p) => !inIds.has(p.id)).map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {isAdmin && !past && !closed && (
                  <div className="drawer-adminadd" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
                    <span className="drawer-sectionlabel"><Ban size={13} /> Close the office (admin)</span>
                    <span className="mcal-addevent">
                      <input
                        type="text"
                        placeholder="Reason (e.g. Filming day)"
                        value={closeReason}
                        maxLength={60}
                        onChange={(e) => setCloseReason(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && closeOffice(iso)}
                      />
                      <button className="btn secondary" style={{ padding: '6px 12px', fontSize: 12.5, color: 'var(--red)' }} onClick={() => closeOffice(iso)}>
                        Close office
                      </button>
                    </span>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
                      No one will be able to book this day{people.length > 0 ? `, and the ${people.length} existing booking${people.length === 1 ? '' : 's'} will be removed` : ''}. A Slack notice is posted that morning. You can reopen it any time.
                    </div>
                  </div>
                )}
                {offPeople.length > 0 && (
                  <div className="mcal-offsection">
                    <span className="mcal-detailcount"><Palmtree size={13} /> {offPeople.length} on holiday</span>
                    <div className="mcal-names drawer-list">
                      {offPeople.map((p) => (
                        <div className="avatar-row holiday" key={p.id}>
                          <Avatar profile={p.profiles || { id: p.user_id, full_name: 'You' }} size={24} />
                          <span className="label">{p.profiles?.full_name || 'You'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {notInPeople.length > 0 && (
                  <div className="mcal-offsection">
                    <span className="mcal-detailcount"><Ban size={13} /> {notInPeople.length} not in</span>
                    <div className="mcal-names drawer-list">
                      {notInPeople.map((a) => (
                        <div className="avatar-row notin" key={a.id}>
                          <Avatar profile={a.profiles || { id: a.user_id, full_name: 'You' }} size={24} absent />
                          <span className="label">{a.user_id === me.id ? 'You' : (a.profiles?.full_name || 'Someone')}</span>
                          {a.reason && <span className="notin-reason" title={a.reason}>"{a.reason}"</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )
      })()}

      {tip && (
        <div className="hovertip" style={{ left: tip.x, top: tip.y }}>{tip.name}</div>
      )}

      {absenceModal && (
        <div className="modal-overlay" onClick={() => setAbsenceModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <Ban size={16} style={{ color: 'var(--red)' }} />
              <h3>Not coming in</h3>
              <div className="spacer" />
              <button className="iconbtn" onClick={() => setAbsenceModal(null)} aria-label="Close"><X size={15} /></button>
            </div>
            <p className="modal-sub">
              {new Date(absenceModal.iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <div className="modal-label">Reason <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></div>
            <textarea
              value={absenceModal.reason}
              onChange={(e) => setAbsenceModal((m) => ({ ...m, reason: e.target.value }))}
              rows={3}
              maxLength={300}
              placeholder="e.g. Working from home, client visit, appointment…"
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', font: 'inherit', fontSize: 13.5, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px' }}
            />
            <label className="modal-check">
              <input
                type="checkbox"
                checked={absenceModal.adminOnly}
                onChange={(e) => setAbsenceModal((m) => ({ ...m, adminOnly: e.target.checked, isPublic: e.target.checked ? false : m.isPublic }))}
              />
              <span>Keep this private — only admins see it (you won't appear on the team calendar)</span>
            </label>
            <label className="modal-check">
              <input
                type="checkbox"
                checked={absenceModal.isPublic}
                onChange={(e) => setAbsenceModal((m) => ({ ...m, isPublic: e.target.checked, adminOnly: e.target.checked ? false : m.adminOnly }))}
              />
              <span>Share publicly — show me as “not in” (red) and my reason to everyone</span>
            </label>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
              Admin-only reasons are never visible to other employees.
            </div>
            <div className="modal-actions">
              {absenceModal.existing && (
                <button className="btn ghost" style={{ marginRight: 'auto', color: 'var(--red)' }} onClick={() => removeAbsence(absenceModal.iso)}>
                  Remove
                </button>
              )}
              <button className="btn secondary" onClick={() => setAbsenceModal(null)}>Cancel</button>
              <button className="btn" onClick={saveAbsence}>Save</button>
            </div>
          </div>
        </div>
      )}

      {confirmBooking && (
        <div className="modal-overlay" style={{ zIndex: 400 }} onClick={() => setConfirmBooking(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <CalendarCheck size={16} style={{ color: 'var(--amber)' }} />
              <h3>Heads up</h3>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', margin: '4px 0 0', lineHeight: 1.5 }}>
              You’re booking <strong>{new Date(confirmBooking + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>,
              which isn’t your assigned office day ({assignedLabel}). You can still book it — just so you know.
            </p>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setConfirmBooking(null)}>Cancel</button>
              <button className="btn" onClick={() => { const iso = confirmBooking; setConfirmBooking(null); performToggle(iso) }}>
                Book anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
