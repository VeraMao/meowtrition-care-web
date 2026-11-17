import { NavLink, Navigate, Route, Routes, Link } from 'react-router-dom'
import { configured } from './lib/supabase'
import { useSession } from './lib/session'
import Login from './pages/Login'
import Home from './pages/Home'
import Log from './pages/Log'
import Trends from './pages/Trends'
import Health from './pages/Health'
import Report from './pages/Report'
import Profile from './pages/Profile'

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/log', label: 'Log' },
  { to: '/trends', label: 'Trends' },
  { to: '/health', label: 'Health' },
]

function TopBar() {
  const { cats, cat, selectCat } = useSession()
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center justify-between gap-2 px-4 py-2">
        <span className="font-semibold">Meowtrition</span>
        <div className="flex items-center gap-2">
          {cats.length > 0 && (
            <select aria-label="Current cat" value={cat?.id ?? ''} onChange={e => selectCat(e.target.value)}
              className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-medium">
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_demo ? ' (demo)' : ''}</option>)}
            </select>
          )}
          <Link to="/profile" className="flex min-h-11 items-center rounded-xl px-3 text-sm font-medium hover:bg-soft">Profile</Link>
        </div>
      </div>
    </header>
  )
}

function BottomNav() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-xl">
        {NAV.map(n => (
          <li key={n.to} className="flex-1">
            <NavLink to={n.to} end={n.to === '/'}
              className={({ isActive }) => `flex min-h-14 items-center justify-center text-sm ${isActive ? 'font-semibold text-ink' : 'text-muted'}`}>
              {({ isActive }) => <span className={isActive ? 'border-b-2 border-ink pb-0.5' : 'pb-0.5'}>{n.label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export default function App() {
  const { session, loading, catsLoaded, cats } = useSession()
  if (!configured) return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Setup needed</h1>
      <p className="mt-2 text-muted">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code>, then restart <code>npm run dev</code>.</p>
    </main>
  )
  if (loading) return <p className="p-6 text-muted">Loading…</p>
  if (!session) return <Login />
  // Wait for the cat list before routing; otherwise a refresh briefly sees "no cats" and jumps to /profile.
  if (!catsLoaded) return <p className="p-6 text-muted">Loading…</p>
  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/profile" element={<Profile />} />
        {cats.length === 0
          ? <Route path="*" element={<Navigate to="/profile" replace />} />
          : <>
              <Route path="/" element={<Home />} />
              <Route path="/log" element={<Log />} />
              <Route path="/trends" element={<Trends />} />
              <Route path="/health" element={<Health />} />
              <Route path="/health/report/:id" element={<Report />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>}
      </Routes>
      {cats.length > 0 && <BottomNav />}
    </>
  )
}
