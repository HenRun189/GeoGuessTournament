import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Link, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router-dom';
import './index.css';
import HomePage from './pages/HomePage';
import CreatePage from './pages/CreatePage';
import AdminPage from './pages/AdminPage';
import TournamentPage from './pages/TournamentPage';
import OverlayPage from './pages/OverlayPage';
import PlayerPage from './pages/PlayerPage';
import RulesPage from './pages/RulesPage';
import { api } from './lib/api';

interface AdminAuthContextValue {
  status: 'checking' | 'authenticated' | 'anonymous';
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function useAdminAuth(): AdminAuthContextValue {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used within the application shell');
  return context;
}

function AppShell() {
  const [status, setStatus] = useState<AdminAuthContextValue['status']>('checking');
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const showMenu = !location.pathname.startsWith('/overlay/') && !location.pathname.startsWith('/player/');

  useEffect(() => {
    let active = true;
    void api.checkAdmin().then(({ authenticated }) => {
      if (active) setStatus(authenticated ? 'authenticated' : 'anonymous');
    }).catch(() => { if (active) setStatus('anonymous'); });
    return () => { active = false; };
  }, []);

  const auth = useMemo<AdminAuthContextValue>(() => ({
    status,
    login: async (candidate) => {
      await api.loginAdmin(candidate);
      setStatus('authenticated');
    },
    logout: async () => {
      await api.logoutAdmin();
      setStatus('anonymous');
    },
  }), [status]);

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(password);
      setPassword('');
      setLoginOpen(false);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Anmeldung fehlgeschlagen');
    } finally { setBusy(false); }
  };

  return (
    <AdminAuthContext.Provider value={auth}>
      {showMenu && <header className="border-b border-slate-800 bg-slate-950/95">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="font-black tracking-tight">GeoGuessr <span className="text-emerald-400">Turnier</span></Link>
          <div className="relative flex items-center gap-2">
            {status === 'authenticated' && <span className="hidden text-xs font-semibold text-emerald-300 sm:inline">Admin angemeldet</span>}
            {status === 'authenticated' ? <>
              <Link to="/create" className="btn-ghost text-xs">Neues Turnier</Link>
              <button className="btn-secondary text-xs" onClick={async () => {
                try { await auth.logout(); navigate('/'); }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'Abmelden fehlgeschlagen'); }
              }}>Abmelden</button>
            </> : <button className="btn-secondary text-xs" onClick={() => { setLoginOpen((open) => !open); setError(null); }}>
              {status === 'checking' ? 'Admin-Status…' : 'Admin-Login'}
            </button>}
            {status !== 'authenticated' && loginOpen && <form onSubmit={(event) => void submitLogin(event)} className="absolute right-0 top-12 z-50 w-72 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
              <h2 className="mb-3 font-bold">Admin-Anmeldung</h2>
              <label className="label" htmlFor="global-admin-password">Globales Admin-Passwort</label>
              <input autoFocus id="global-admin-password" className="input mb-3" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <button className="btn-primary w-full" disabled={busy || !password}>{busy ? 'Wird geprüft…' : 'Anmelden'}</button>
              {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
            </form>}
          </div>
        </nav>
      </header>}
      <Outlet />
    </AdminAuthContext.Provider>
  );
}

const router = createBrowserRouter([{
  path: '/',
  element: <AppShell />,
  children: [
    { index: true, element: <HomePage /> },
    { path: 'create', element: <CreatePage /> },
    { path: 'rules', element: <RulesPage /> },
    { path: 'admin/:id', element: <AdminPage /> },
    { path: 'tournament/:id', element: <TournamentPage /> },
    { path: 'player/:tournamentId/:unitId/:slug?', element: <PlayerPage /> },
    { path: 'overlay/:id', element: <OverlayPage /> },
  ],
}]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
