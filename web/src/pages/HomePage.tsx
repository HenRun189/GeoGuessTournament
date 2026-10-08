// Home: tournament list, demo mode, create-new entry point.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TournamentSummaryDTO } from '@gt/shared';
import { api } from '../lib/api';

export default function HomePage() {
  const [tournaments, setTournaments] = useState<TournamentSummaryDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoPassword, setDemoPassword] = useState('');
  const navigate = useNavigate();

  const load = () => {
    api
      .listTournaments()
      .then((r) => setTournaments(r.tournaments))
      .catch((e) => setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen'));
  };

  useEffect(load, []);

  const createDemo = async (kind: 'full' | 'team' | 'groups') => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createDemo(kind, demoPassword);
      setDemoPassword('');
      navigate(`/admin/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Demoeinstellung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const deleteDemo = async () => {
    setBusy(true);
    try {
      await api.deleteDemo();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const deleteOneDemo = async (id: string) => {
    setBusy(true);
    try {
      await api.deleteTournament(id);
      setTournaments((rows) => rows.filter((row) => row.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen');
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">
            GeoGuessr <span className="text-emerald-400">Turnier</span>
          </h1>
          <p className="text-sm text-slate-400">Host, führe Turniere durch und stream — Alpha/Beta</p>
          <Link to="/rules" className="mt-2 inline-block text-xs font-semibold text-emerald-300 underline">Regeln & Ablauf</Link>
        </div>
        <Link to="/create" className="btn-primary">
          + Neues Turnier
        </Link>
      </div>

      <div className="card mb-6">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Demomodus</div>
        <label className="label" htmlFor="demo-admin-password">Admin-Passwort für das Demo-Turnier (mindestens 10 Zeichen)</label>
        <input id="demo-admin-password" className="input mb-3 max-w-md" type="password" autoComplete="new-password" value={demoPassword} onChange={(event) => setDemoPassword(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy || demoPassword.length < 10}
            onClick={() => void createDemo('full')}
            className="btn-secondary"
          >
            Demo erstellen (7 Spieler, fertig)
          </button>
          <button
            disabled={busy || demoPassword.length < 10}
            onClick={() => void createDemo('team')}
            className="btn-secondary"
          >
            Demo erstellen (8 → 4 Teams, fertig)
          </button>
          <button
            disabled={busy || demoPassword.length < 10}
            onClick={() => void createDemo('groups')}
            className="btn-secondary"
          >
            Demo erstellen (6 Spieler, Gruppen)
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              const demos = tournaments.filter((tournament) => tournament.isDemo);
              if (!demos.length) return;
              try {
                for (const tournament of demos) {
                  const password = window.prompt(`Admin-Passwort für „${tournament.name}“`);
                  if (!password) return;
                  await api.loginAdmin(tournament.id, password);
                }
                await deleteDemo();
              } catch (e) { setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen'); }
            }}
            className="btn-danger"
          >
            Alle Demo-Turniere löschen
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/15 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {tournaments.length === 0 && (
          <div className="text-sm text-slate-500">
            Noch keine Turniere. Erstelle eins, um zu beginnen.
          </div>
        )}
        {tournaments.map((t) => (
          <div
            key={t.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3"
          >
            <div>
              <div className="flex items-center gap-2 font-bold">
                {t.name}
                {t.isDemo && (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-400">
                    Demo
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {t.participantCount} Teilnehmer · {t.state} · <span className="font-mono">{t.id}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/admin/${t.id}`} className="btn-secondary">
                Admin
              </Link>
              <Link to={`/tournament/${t.id}`} className="btn-ghost">
                Öffentliche Seite
              </Link>
              <Link to={`/overlay/${t.id}`} className="btn-ghost">
                Overlay
              </Link>
              <button className="btn-danger" disabled={busy} onClick={async () => {
                if (!window.confirm(`Admin-Passwort für „${t.name}“ eingeben, um dieses Turnier zu löschen?`)) return;
                const password = window.prompt('Admin-Passwort');
                if (!password) return;
                try { await api.loginAdmin(t.id, password); await api.deleteTournament(t.id); setTournaments((rows) => rows.filter((row) => row.id !== t.id)); }
                catch (e) { setError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen'); }
              }}>Löschen</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
