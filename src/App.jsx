import { useEffect, useState } from 'react'
import { LogOut, CalendarDays, BarChart3, Trophy } from 'lucide-react'
import { supabase, DEMO } from './lib/supabase'
import Avatar from './components/Avatar'
import WeekCalendar from './components/WeekCalendar'
import AdminDashboard from './components/AdminDashboard'
import VoteTab from './components/VoteTab'
import logo from './assets/higherin-logo.svg'

function Login() {
  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: 'slack_oidc',
      options: { redirectTo: window.location.origin },
    })

  return (
    <div className="login">
      <div className="login-card">
        <img src={logo} alt="Higherin" style={{ height: 44, display: 'block', margin: '0 auto', transform: 'rotate(-3deg)' }} />
        <h1>Office Attendance</h1>
        <p>Plan your office days and see who else will be in.</p>
        <button className="slackbtn" onClick={signIn}>
          <svg width="20" height="20" viewBox="0 0 122.8 122.8" aria-hidden="true">
            <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"/>
            <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"/>
            <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"/>
            <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"/>
          </svg>
          Sign in with Slack
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)
  const [tab, setTab] = useState('calendar')
  const [toast, setToast] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session?.user?.id])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  if (session === undefined) {
    return (
      <div className="loading">
        <div>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Loading…
        </div>
      </div>
    )
  }

  if (!session) return <Login /> // unreachable in the demo: the mock client always has a session

  return (
    <div className="app">
      {DEMO && (
        <div className="demo-banner">
          Demo preview — sample data, nothing is saved
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <img src={logo} alt="Higherin" style={{ height: 30, display: 'block', transform: 'rotate(-3deg)' }} />
          <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>/</span>
          Office Attendance
        </div>
        <div className="spacer" />
        <nav className="tabs">
          <button className={`tab ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>
            <CalendarDays size={15} /> Calendar
          </button>
          <button className={`tab ${tab === 'vote' ? 'active' : ''}`} onClick={() => setTab('vote')}>
            <Trophy size={15} /> Vote
          </button>
          {(profile?.is_admin || profile?.is_super_admin) && (
            <button className={`tab ${tab === 'admin' ? 'active' : ''}`} onClick={() => setTab('admin')}>
              <BarChart3 size={15} /> Admin
            </button>
          )}
        </nav>
        <div className="userchip">
          <Avatar profile={profile} size={30} />
          <span className="name">{profile?.full_name}</span>
          <button className="signout" onClick={() => supabase.auth.signOut()} title="Sign out">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      {tab === 'calendar' && <WeekCalendar me={session.user} profile={profile} isAdmin={!!profile?.is_admin} showToast={showToast} />}
      {tab === 'vote' && <VoteTab me={session.user} isAdmin={!!profile?.is_admin} isSuper={!!profile?.is_super_admin} showToast={showToast} />}
      {tab === 'admin' && (profile?.is_admin || profile?.is_super_admin) && <AdminDashboard profile={profile} showToast={showToast} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
