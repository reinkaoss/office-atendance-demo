import { useEffect, useMemo, useState } from 'react'
import { Trophy, Search, Check, Pencil, X, Eye, EyeOff, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Avatar from './Avatar'

function monthStartISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function monthLabel(d = new Date()) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
function monthLabelOf(iso) {
  const [y, m] = (iso || monthStartISO()).split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
function shiftMonth(iso, delta) {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function VoteTab({ me, isAdmin, isSuper, showToast }) {
  const [activeMonth, setActiveMonth] = useState(monthStartISO()) // the month being VIEWED
  const [serverMonth, setServerMonth] = useState(monthStartISO()) // the currently OPEN round (server)
  const [votingOpen, setVotingOpen] = useState(true)
  const [expandedMonths, setExpandedMonths] = useState(() => new Set())
  const [pickerOpen, setPickerOpen] = useState(true) // collapse the colleague grid
  const monthISO = activeMonth
  // you can only vote when the month you're viewing IS the open round
  const isOpenRound = votingOpen && activeMonth === serverMonth
  const [profiles, setProfiles] = useState([])
  const [allProfiles, setAllProfiles] = useState([])
  const [standings, setStandings] = useState([])
  const [allVotes, setAllVotes] = useState([]) // every ballot this month (super admin only)
  const [myVotes, setMyVotes] = useState([]) // my ballot(s) this month (admins can have several)
  const [turnout, setTurnout] = useState(null)
  const [results, setResults] = useState([])
  const [search, setSearch] = useState('')
  const [nominee, setNominee] = useState(null)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [hiddenComments, setHiddenComments] = useState(() => new Set()) // super-admin: hide comments while announcing

  // viewOverride = browse a specific month (arrows). No server change; only the toggle opens/closes.
  const load = async (viewOverride) => {
    let srv = monthStartISO(); let open = true
    if (supabase.rpc) {
      const s = await supabase.rpc('eotm_status')
      const srow = Array.isArray(s.data) ? s.data[0] : s.data
      if (srow) { srv = srow.active_month; open = !!srow.voting_open }
    }
    setServerMonth(srv); setVotingOpen(open)
    const view = viewOverride || srv
    setActiveMonth(view)
    const [p, v, t, r, st, av] = await Promise.all([
      supabase.from('profiles').select('id, full_name, avatar_url, email').order('full_name'),
      supabase.from('eotm_votes').select('nominee_id, reason').eq('voter_id', me.id).eq('month', view),
      supabase.rpc ? supabase.rpc('eotm_turnout', { p_month: view }) : Promise.resolve({ data: null }),
      supabase.from('eotm_results').select('month, winner_ids, vote_count').order('month', { ascending: false }),
      supabase.rpc ? supabase.rpc('eotm_standings', { p_month: view }) : Promise.resolve({ data: [] }),
      // every ballot with reasons across ALL months — super admin only (RLS returns just your own otherwise)
      isSuper
        ? supabase.from('eotm_votes').select('voter_id, nominee_id, reason, month')
        : Promise.resolve({ data: [] }),
    ])
    setAllProfiles(p.data || [])
    setProfiles((p.data || []).filter((x) => x.id !== me.id))
    const mine = v.data || []
    setMyVotes(mine)
    if (!isAdmin && mine[0]) { setNominee(mine[0].nominee_id); setReason(mine[0].reason) }
    const row = Array.isArray(t.data) ? t.data[0] : t.data
    setTurnout(row || null)
    setResults(r.data || [])
    setStandings(st.data || [])
    setAllVotes(av.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const myVote = myVotes[0] || null // non-admins have at most one
  const votedIds = useMemo(() => new Set(myVotes.map((v) => v.nominee_id)), [myVotes])

  const filtered = useMemo(() => {
    let list = profiles
    if (isAdmin) list = list.filter((p) => !votedIds.has(p.id)) // can't vote the same person twice
    const q = search.trim().toLowerCase()
    return q ? list.filter((p) => p.full_name.toLowerCase().includes(q)) : list
  }, [profiles, search, isAdmin, votedIds])

  const profileById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles])
  const nomineeProfile = nominee ? profileById[nominee] : null
  const canSubmit = nominee && reason.trim().length >= 5 && isOpenRound

  // active-month ballots grouped by nominee, with each comment + who left it (super admin only)
  const voteAgg = useMemo(() => {
    const byId = Object.fromEntries(allProfiles.map((p) => [p.id, p]))
    const m = {}
    for (const v of allVotes) {
      if (v.month && v.month !== monthISO) continue
      const e = (m[v.nominee_id] ||= { profile: byId[v.nominee_id], count: 0, comments: [] })
      e.count++
      if (v.reason) e.comments.push({ voter: byId[v.voter_id], reason: v.reason })
    }
    return Object.values(m).sort((a, b) => b.count - a.count)
  }, [allVotes, allProfiles, monthISO])

  // past months: winners for everyone (from results); full standings + comments for super admin (from all votes)
  const history = useMemo(() => {
    const byId = Object.fromEntries(allProfiles.map((p) => [p.id, p]))
    const resultByMonth = Object.fromEntries((results || []).map((r) => [r.month, r]))
    const votesByMonth = {}
    for (const v of allVotes) { (votesByMonth[v.month] ||= []).push(v) }
    // "past" = strictly before the currently-open month (so a later month never shows as past)
    const months = [...new Set([...(results || []).map((r) => r.month), ...Object.keys(votesByMonth)])]
      .filter((mo) => mo && mo < monthISO)
      .sort().reverse()
    return months.map((month) => {
      const res = resultByMonth[month]
      const tally = {}
      for (const v of (votesByMonth[month] || [])) {
        const e = (tally[v.nominee_id] ||= { profile: byId[v.nominee_id], count: 0, comments: [] })
        e.count++
        if (v.reason) e.comments.push({ voter: byId[v.voter_id], reason: v.reason })
      }
      const standings = Object.values(tally).sort((a, b) => b.count - a.count)
      const winnerIds = res?.winner_ids || (standings[0]?.profile ? [standings[0].profile.id] : [])
      const winners = winnerIds.map((id) => byId[id]).filter(Boolean)
      const voteCount = res?.vote_count ?? (standings[0]?.count || 0)
      return { month, winners, voteCount, standings }
    })
  }, [results, allVotes, allProfiles, monthISO])

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true)
    let error
    if (isAdmin) {
      // admins can vote for several people — one row per nominee
      ;({ error } = await supabase.from('eotm_votes').upsert(
        { month: monthISO, voter_id: me.id, nominee_id: nominee, reason: reason.trim(), updated_at: new Date().toISOString() },
        { onConflict: 'month,voter_id,nominee_id' }
      ))
    } else {
      // single vote — replace any existing one
      await supabase.from('eotm_votes').delete().eq('voter_id', me.id).eq('month', monthISO)
      ;({ error } = await supabase.from('eotm_votes').insert(
        { month: monthISO, voter_id: me.id, nominee_id: nominee, reason: reason.trim() }
      ))
    }
    setSaving(false)
    if (error) showToast('Could not save your vote — try again')
    else {
      showToast(isAdmin ? 'Vote added 🏆' : myVote ? 'Vote updated' : 'Vote cast 🏆')
      setEditing(false)
      if (isAdmin) { setNominee(null); setReason('') } // reset to add another
      load()
    }
  }

  const removeVote = async (nomineeId) => {
    const { error } = await supabase.from('eotm_votes').delete().eq('voter_id', me.id).eq('month', monthISO).eq('nominee_id', nomineeId)
    if (error) showToast('Could not remove vote')
    else { showToast('Vote removed'); load() }
  }

  const showForm = (isAdmin || !myVote || editing) && isOpenRound

  const setVoting = async (month, open) => {
    const { error } = await supabase.rpc('set_eotm_voting', { p_month: month, p_open: open })
    if (error) showToast('Could not update — try again')
    else { showToast(open ? `Voting open for ${monthLabelOf(month)}` : 'Voting closed'); load() }
  }

  return (
    <div className="vote">
      <div className="weeknav">
        <div>
          <h2>Employee of the Month</h2>
          <div className="sub">
            {isOpenRound
              ? `Voting for ${monthLabelOf(activeMonth)} · open · your ballot is visible to admins`
              : (isSuper ? `Viewing ${monthLabelOf(activeMonth)} · ${activeMonth === serverMonth ? 'closed' : 'not the open round'}` : (votingOpen ? `Voting for ${monthLabelOf(serverMonth)} is open` : 'No voting round is open right now — check back soon'))}
          </div>
        </div>
        <div className="spacer" />
        {turnout && (
          <div className="vote-turnout">
            <div className="bar" style={{ width: 120 }}>
              <div style={{ width: `${turnout.total ? (turnout.voted / turnout.total) * 100 : 0}%` }} />
            </div>
            <span>{turnout.voted}/{turnout.total} voted</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading"><div><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div></div>
      ) : (
        <>
        {isSuper && (
          <div className="card" style={{ padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="iconbtn" title={`View ${monthLabelOf(shiftMonth(activeMonth, -1))}`} onClick={() => load(shiftMonth(activeMonth, -1))}><ChevronLeft size={16} /></button>
              <div style={{ textAlign: 'center', minWidth: 170 }}>
                <div style={{ fontWeight: 700 }}>{monthLabelOf(activeMonth)}</div>
                <div style={{ fontSize: 12, color: isOpenRound ? 'var(--lime-dark)' : 'var(--text-3)' }}>
                  {isOpenRound ? '● Open round' : (activeMonth === serverMonth ? '○ Closed' : 'Viewing (not the open round)')}
                </div>
              </div>
              <button className="iconbtn" title={`View ${monthLabelOf(shiftMonth(activeMonth, 1))}`} onClick={() => load(shiftMonth(activeMonth, 1))}><ChevronRight size={16} /></button>
            </div>
            <div className="spacer" style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Arrows just browse. Toggle opens this month as the round.</span>
            <label className="switch" title={isOpenRound ? 'Close voting' : `Open voting for ${monthLabelOf(activeMonth)}`}>
              <input type="checkbox" checked={isOpenRound} onChange={() => setVoting(activeMonth, !isOpenRound)} />
              <span className="track" />
            </label>
            <span style={{ fontWeight: 700, fontSize: 13, minWidth: 56 }}>{isOpenRound ? 'Open' : 'Closed'}</span>
          </div>
        )}
        {!isOpenRound && (
          <div className="card" style={{ padding: 14, marginBottom: 14, color: 'var(--text-2)' }}>
            🗳️ {isSuper
              ? <>Viewing <strong>{monthLabelOf(activeMonth)}</strong> (records only). {activeMonth === serverMonth ? 'Voting is closed' : 'This isn’t the open round'} — flip the toggle above to open it.</>
              : (votingOpen ? <>Voting for <strong>{monthLabelOf(serverMonth)}</strong> is open — cast your vote there.</> : <>No voting round is open right now. Check back when the next one opens.</>)}
          </div>
        )}
        {isAdmin && myVotes.length > 0 && (
          <div className="card" style={{ padding: '6px 0', marginBottom: 14 }}>
            <div style={{ padding: '12px 18px 6px', fontWeight: 700, fontSize: 13.5 }}>Your votes ({myVotes.length})</div>
            {myVotes.map((v) => {
              const vp = profileById[v.nominee_id]
              return (
                <div key={v.nominee_id} className="vote-mine-row">
                  <Avatar profile={vp} size={26} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{vp?.full_name || 'Someone'}</div>
                    {v.reason && <div className="vote-mine-reason">"{v.reason}"</div>}
                  </div>
                  <button className="row-remove" title="Remove vote" onClick={() => removeVote(v.nominee_id)}><X size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
        {showForm ? (
        <div className="card" style={{ padding: 20 }}>
          <div className="modal-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trophy size={13} /> {isAdmin ? 'Add a vote' : `Who made ${monthLabelOf(activeMonth).split(' ')[0]} better?`}
            <div style={{ flex: 1 }} />
            <button
              className="btn secondary"
              style={{ padding: '3px 10px', fontSize: 12, textTransform: 'none', letterSpacing: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => setPickerOpen((o) => !o)}
            >
              {pickerOpen ? <><ChevronUp size={13} /> Hide list</> : <><ChevronDown size={13} /> Choose colleague</>}
            </button>
          </div>
          {!pickerOpen && nominee && (
            <div className="avatar-row" style={{ margin: '2px 0 4px' }}>
              <Avatar profile={nomineeProfile} size={24} />
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{nomineeProfile?.full_name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>selected</span>
            </div>
          )}
          {pickerOpen && (<>
          <div className="vote-search">
            <Search size={15} style={{ color: 'var(--text-3)' }} />
            <input
              type="text"
              placeholder="Search colleagues…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="vote-grid">
            {filtered.map((p) => (
              <button
                key={p.id}
                className={`vote-person ${nominee === p.id ? 'picked' : ''}`}
                onClick={() => { setNominee(p.id); setPickerOpen(false) }}
              >
                <Avatar profile={p} size={36} />
                <span className="vote-name">{p.full_name}</span>
                {nominee === p.id && <span className="vote-tick"><Check size={12} strokeWidth={3} /></span>}
              </button>
            ))}
            {filtered.length === 0 && <div className="mcal-empty">No one matches "{search}"</div>}
          </div>
          </>)}

          <div className="modal-label" style={{ marginTop: 18 }}>Why them? <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(required)</span></div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="What did they do this month that deserves recognition?"
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 13.5,
              border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px',
            }}
          />
          <div className="modal-actions">
            {editing && <button className="btn secondary" onClick={() => { setEditing(false); setNominee(myVote.nominee_id); setReason(myVote.reason) }}>Cancel</button>}
            <button className="btn" onClick={submit} disabled={!canSubmit || saving}>
              {saving ? 'Saving…' : isAdmin ? 'Add vote' : myVote ? 'Update vote' : 'Cast vote'}
            </button>
          </div>
        </div>
      ) : myVote ? (
        <div className="card vote-done">
          <div className="vote-doneicon"><Trophy size={22} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700 }}>Your {monthLabelOf(activeMonth).split(' ')[0]} vote is in</div>
            <div className="avatar-row" style={{ marginTop: 8 }}>
              <Avatar profile={nomineeProfile} size={28} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{nomineeProfile?.full_name}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 6, fontStyle: 'italic' }}>"{myVote.reason}"</div>
          </div>
          {isOpenRound && (
            <button className="btn secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setEditing(true)}>
              <Pencil size={13} /> Change
            </button>
          )}
        </div>
        ) : null}
        </>
      )}

      {isSuper && voteAgg.length > 0 && (() => {
        const allKeys = voteAgg.flatMap(({ profile: p, comments }) => comments.map((_, i) => `${p?.id}:${i}`))
        const allHidden = allKeys.length > 0 && allKeys.every((k) => hiddenComments.has(k))
        const toggle = (key) => setHiddenComments((prev) => {
          const next = new Set(prev)
          if (next.has(key)) next.delete(key); else next.add(key)
          return next
        })
        return (
        <>
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            This month's votes <span className="badge warn">Admin</span>
            {allKeys.length > 0 && (
              <button
                className="btn secondary"
                style={{ marginLeft: 'auto', padding: '5px 12px', fontSize: 12.5 }}
                onClick={() => setHiddenComments(allHidden ? new Set() : new Set(allKeys))}
              >
                {allHidden ? 'Show all comments' : 'Hide all comments'}
              </button>
            )}
          </h3>
          <div className="card" style={{ padding: '6px 0' }}>
            {voteAgg.map(({ profile: p, count, comments }) => (
              <div key={p?.id} className="vote-agg">
                <div className="vote-agg-head">
                  <Avatar profile={p} size={28} />
                  <span className="vote-agg-name">{p?.full_name}</span>
                  <span className="badge ok">{count} vote{count === 1 ? '' : 's'}</span>
                </div>
                {comments.length > 0 && (
                  <div className="vote-agg-comments">
                    {comments.map((c, i) => {
                      const key = `${p?.id}:${i}`
                      const hidden = hiddenComments.has(key)
                      return (
                        <div key={i} className="vote-agg-comment" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <button
                            className="iconbtn"
                            title={hidden ? 'Show comment' : 'Hide comment'}
                            style={{ padding: 3, flexShrink: 0 }}
                            onClick={() => toggle(key)}
                          >
                            {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          {hidden ? (
                            <span style={{ color: 'var(--text-3)', fontStyle: 'italic', fontSize: 13 }}>hidden</span>
                          ) : (
                            <span>
                              <span className="vote-agg-voter">{c.voter?.full_name || 'Someone'}:</span>{' '}
                              <span className="vote-agg-reason">"{c.reason}"</span>
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
        )
      })()}

      {isAdmin && standings.length > 0 && (() => {
        const byId = Object.fromEntries(allProfiles.map((p) => [p.id, p]))
        const ranked = standings.map((s) => ({ profile: byId[s.nominee_id], count: Number(s.votes) }))
        const podium = ranked.slice(0, 3)
        const rest = ranked.slice(3)
        const order = [podium[1], podium[0], podium[2]].filter(Boolean) // 2nd, 1st, 3rd
        // competition ranking: equal vote counts share the same place (ties = joint 1st, etc.)
        const place = (entry) => ranked.filter((x) => x.count > entry.count).length + 1
        const maxCount = ranked[0]?.count || 1
        // a podium only makes sense with a clear top 3; if 4+ share the lead it's a flat list
        const leadersAtTop = ranked.filter((r) => r.count === maxCount).length
        const usePodium = leadersAtTop <= 3 && ranked.length > 1
        return (
          <>
            <h3 className="section-title">Current standings <span className="badge warn">Admin</span></h3>
            <div className="card" style={{ padding: usePodium ? '26px 20px 20px' : '8px 0' }}>
              {usePodium ? (
                <>
                  <div className="podium">
                    {order.map((entry) => (
                      <div key={entry.profile?.id} className="podium-col">
                        <Avatar profile={entry.profile} size={place(entry) === 1 ? 52 : 40} />
                        <span className="podium-name">{entry.profile?.full_name}</span>
                        <span className="podium-votes">{entry.count} vote{entry.count === 1 ? '' : 's'}</span>
                        <div className={`podium-block p${place(entry)}`}>{place(entry)}</div>
                      </div>
                    ))}
                  </div>
                  {rest.length > 0 && (
                    <div className="podium-rest">
                      {rest.map((entry, i) => (
                        <div key={entry.profile?.id || i} className="podium-restrow">
                          <span style={{ width: 22, color: 'var(--text-3)', fontWeight: 700, fontSize: 12.5 }}>{place(entry)}.</span>
                          <Avatar profile={entry.profile} size={22} />
                          <span style={{ fontWeight: 600, fontSize: 13.5, flex: '0 0 auto' }}>{entry.profile?.full_name}</span>
                          <div className="bar" style={{ flex: 1 }}><div style={{ width: `${(entry.count / maxCount) * 100}%` }} /></div>
                          <span style={{ fontSize: 12.5, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{entry.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="standings-list">
                  {leadersAtTop > 1 && (
                    <div className="standings-tiebanner">🤝 {leadersAtTop}-way tie for 1st — {maxCount} vote{maxCount === 1 ? '' : 's'} each</div>
                  )}
                  {ranked.map((entry, i) => (
                    <div key={entry.profile?.id || i} className="podium-restrow">
                      <span style={{ width: 22, color: 'var(--text-3)', fontWeight: 700, fontSize: 12.5 }}>{place(entry)}.</span>
                      <Avatar profile={entry.profile} size={24} />
                      <span style={{ fontWeight: 600, fontSize: 13.5, flex: '0 0 auto' }}>{entry.profile?.full_name}</span>
                      <div className="bar" style={{ flex: 1 }}><div style={{ width: `${(entry.count / maxCount) * 100}%` }} /></div>
                      <span style={{ fontSize: 12.5, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{entry.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      })()}

      {history.length > 0 && (
        <>
          <h3 className="section-title">Past months{isSuper && <span className="badge warn" style={{ marginLeft: 8 }}>full records</span>}</h3>
          <div className="card" style={{ padding: '6px 0' }}>
            {history.map((h) => {
              const expanded = expandedMonths.has(h.month)
              const canExpand = isSuper && h.standings.length > 0
              return (
                <div key={h.month} className="vote-agg">
                  <div className="vote-agg-head" style={{ gap: 10 }}>
                    <span style={{ fontWeight: 700, minWidth: 130 }}>{monthLabelOf(h.month)}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                      {h.winners.length ? h.winners.map((p) => (
                        <span key={p.id} className="avatar-row">
                          <Avatar profile={p} size={24} />
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.full_name}</span>
                        </span>
                      )) : <span style={{ color: 'var(--text-3)', fontSize: 13 }}>No winner recorded</span>}
                      {h.voteCount > 0 && <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>🏆 {h.voteCount} vote{h.voteCount === 1 ? '' : 's'}</span>}
                    </div>
                    {canExpand && (
                      <button
                        className="btn secondary"
                        style={{ padding: '4px 10px', fontSize: 12.5 }}
                        onClick={() => setExpandedMonths((prev) => { const n = new Set(prev); if (n.has(h.month)) n.delete(h.month); else n.add(h.month); return n })}
                      >
                        {expanded ? 'Hide' : 'Details'}
                      </button>
                    )}
                  </div>
                  {canExpand && expanded && (
                    <div style={{ padding: '2px 18px 12px' }}>
                      {h.standings.map((s) => (
                        <div key={s.profile?.id} style={{ marginBottom: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.profile?.full_name || 'Someone'} · {s.count} vote{s.count === 1 ? '' : 's'}</div>
                          {s.comments.map((c, i) => (
                            <div key={i} className="vote-agg-comment">
                              <span className="vote-agg-voter">{c.voter?.full_name || 'Someone'}:</span>{' '}
                              <span className="vote-agg-reason">"{c.reason}"</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
