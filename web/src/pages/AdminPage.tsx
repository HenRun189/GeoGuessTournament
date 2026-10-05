// Moderator panel: tournament flow control + fast result entry.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TournamentStateDTO, OverlaySettingsDTO } from '@gt/shared';
import { api, unitName, useTournamentState } from '../lib/api';
import StandingsTable from '../components/StandingsTable';
import MatchList from '../components/MatchList';
import ResultEntry from '../components/ResultEntry';
import Bracket from '../components/Bracket';

const STATE_LABELS: Record<string, string> = {
  SETUP: 'Einrichten',
  PRELIMINARY: 'Vorrunde',
  SEMIFINALS: 'Halbfinale',
  FINAL: 'Finale',
  FINISHED: 'Beendet',
};

export default function AdminPage() {
  const { id } = useParams<{ id: string }>();
  const { state, error, connected, refresh } = useTournamentState(id ?? null);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<{ text: string; action: () => Promise<void> } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [copiedUnitId, setCopiedUnitId] = useState<string | null>(null);
  const [pingingUnitId, setPingingUnitId] = useState<string | null>(null);

  if (error && !state) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="card text-red-400">{error}</div>
      </div>
    );
  }
  if (!state) {
    return <div className="mx-auto max-w-4xl px-4 py-10 text-slate-400">Laden…</div>;
  }

  const act = (fn: () => Promise<unknown>, okMsg?: string) => async () => {
    try {
      await fn();
      if (okMsg) {
        setFlash(okMsg);
        setTimeout(() => setFlash(null), 2500);
      }
    } catch (e) {
      setFlash(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
      setTimeout(() => setFlash(null), 4000);
    }
  };

  const confirm = (text: string, action: () => Promise<unknown>) => {
    setConfirmMsg({
      text,
      action: async () => {
        await action();
        setConfirmMsg(null);
      },
    });
  };

  const started = state.state !== 'SETUP';
  const scheduleOrder = (m: TournamentStateDTO['matches'][number]) =>
    (m.stage === 'PRELIMINARY' ? 0 : m.stage === 'SEMIFINALS' ? 1 : 2) * 10000 + m.orderInStage;
  const participantRows = state.units.map((unit) => {
    const ownMatches = state.matches.filter((m) => m.aUnitId === unit.id || m.bUnitId === unit.id);
    const active = ownMatches.find((m) => m.status === 'live') ?? null;
    const upcoming = active ?? ownMatches.find((m) => m.status === 'waiting') ?? null;
    const current = active;
    const eliminated = state.knockout?.eliminatedUnitIds.includes(unit.id) ?? false;
    const waitingBefore = upcoming ? state.matches.filter((m) => (m.status === 'waiting' || m.status === 'live') && m.aUnitId && m.bUnitId && scheduleOrder(m) < scheduleOrder(upcoming)).length : 0;
    const status = active ? 'JETZT DRAN' : upcoming ? (waitingBefore === 0 ? 'ALS NÄCHSTES DRAN' : `NOCH ${waitingBefore} SPIELE`) : eliminated ? 'AUSGESCHIEDEN' : ownMatches.length ? 'Gespielt' : 'WARTET';
    const opponentId = (match: typeof upcoming) => match ? match.aUnitId === unit.id ? match.bUnitId : match.aUnitId : null;
    const path = `/player/${encodeURIComponent(state.id)}/${encodeURIComponent(unit.id)}/${encodeURIComponent(unit.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}`;
    const url = typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString();
    return { unit, ownMatches, active, upcoming, current, eliminated, waitingBefore, status, opponentId: opponentId(active ?? upcoming), path, url };
  });

  const nextMatches = state.matches
    .filter((m) => m.status === 'waiting' && m.aUnitId && m.bUnitId)
    .slice(0, 3);
  const immediateNext = state.matches
    .filter((m) => m.status === 'waiting' && m.aUnitId && m.bUnitId)
    .sort((a, b) => scheduleOrder(a) - scheduleOrder(b))[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-black">{state.name}</h1>
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-400">{state.id}</span>
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} title={connected ? 'Live' : 'Abrufen'} />
          </div>
          <div className="text-xs text-slate-500">
            {STATE_LABELS[state.state]} · {state.participantCount} Teilnehmer ·{' '}
            {state.format === 'groups_of_3' ? 'Gruppen' : state.format === 'random_three' ? '3 zufällige Gegner' : 'Rundenspiel'}
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/tournament/${state.id}`} className="btn-ghost text-xs">
            Öffentliche Seite ↗
          </Link>
          <Link to={`/overlay/${state.id}`} className="btn-ghost text-xs">
            Overlay ↗
          </Link>
          <Link to="/" className="btn-ghost text-xs">
            Startseite
          </Link>
        </div>
      </div>

      {flash && <div className="mb-3 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200">{flash}</div>}

      {/* state controls */}
      <div className="card mb-4 flex flex-wrap gap-2">
        {!started && (
          <button
            className="btn-primary"
            onClick={() => confirm('Turnier starten?', async () => { await api.setState(state.id, 'PRELIMINARY'); })}
          >
            Turnier starten
          </button>
        )}
        {started && state.state !== 'FINISHED' && (
          <>
            <button className="btn-secondary" onClick={act(() => api.setState(state.id, nextStageOf(state)), 'Stadium gewechselt')}>
              ⏭ Nächstes Stadium erzwingen
            </button>
            <button
              className="btn-danger"
              onClick={() => confirm('Letztes gespeichertes Ergebnis rückgängig machen?', () => api.undo(state.id))}
            >
              ↩ Letztes Ergebnis rückgängig
            </button>
            <button
              className="btn-secondary"
              onClick={() => confirm('Turnier jetzt beenden? Verbleibende Spiele bleiben unvollendet.', () => api.setState(state.id, 'FINISHED'))}
            >
              🏁 Turnier beenden
            </button>
          </>
        )}
        <button
          className="btn-danger"
          onClick={() => confirm('Turnier zurücksetzen? Alle Ergebnisse werden gelöscht und der Spielplan wird neu erstellt.', () => api.reset(state.id))}
        >
          ⟲ Turnier zurücksetzen
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        {/* left column */}
        <div className="space-y-4">
          {/* current match */}
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">Aktuelles Spiel</div>
              {state.currentMatchId && (
                <button className="btn-ghost text-xs" onClick={act(() => api.setCurrentMatch(state.id, null))}>
                  Aktuelles entfernen
                </button>
              )}
            </div>
            {state.currentMatchId ? (
              <ResultEntry matchId={state.currentMatchId} state={state} onSaved={() => void refresh()} />
            ) : (
              <div className="text-sm text-slate-500">
                Kein aktuelles Spiel ausgewählt. 'Als Live setzen' auf einem Spiel verwenden →
                {nextMatches.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {nextMatches.map((m) => (
                      <button key={m.id} className="btn-secondary text-xs" onClick={act(() => api.setCurrentMatch(state.id, m.id))}>
                        {unitName(state, m.aUnitId)} vs {unitName(state, m.bUnitId)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* immediate next match */}
          {immediateNext && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-300">Als Nächstes</div>
            <div className="mt-1 font-semibold">{unitName(state, immediateNext.aUnitId)} <span className="text-slate-500">vs</span> {unitName(state, immediateNext.bUnitId)} · {immediateNext.label}</div>
          </div>}

          {/* matches */}
          <div className="card">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">Spiele pro Stadium</div>
            <MatchList
              state={state}
              selectedMatchId={state.currentMatchId}
              editingMatchId={editingMatchId}
              onSelectCurrent={(mid) => void act(() => api.setCurrentMatch(state.id, mid))()}
              onEdit={(mid) => {
                setEditingMatchId(mid);
                void act(() => api.setCurrentMatch(state.id, mid))();
              }}
            />
          </div>
        </div>

        {/* right column */}
        <div className="space-y-4">
          {/* ranking / groups */}
          <div className="card">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
              {state.groups.length ? 'Gruppentabelle' : 'Tabellenstellung'}
            </div>
            {state.groups.length > 0 ? (
              <div className="space-y-4">
                {state.groups.map((g) => (
                  <StandingsTable key={g.id} title={g.name} rows={state.groupStandings[g.id] ?? []} showFlags />
                ))}
                <div className="border-t border-slate-800 pt-2">
                  <StandingsTable rows={state.standings} title="Gesamt" showFlags />
                </div>
              </div>
            ) : (
              <StandingsTable rows={state.standings} showFlags />
            )}
          </div>

          {/* bracket */}
          <div className="card">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">Turnierbaum</div>
            <Bracket state={state} />
          </div>

          {/* overlay settings */}
          <OverlaySettingsCard state={state} />
        </div>
      </div>

      <section className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
        <button type="button" aria-expanded={participantsOpen} onClick={() => setParticipantsOpen((open) => !open)} className="flex w-full items-center justify-between px-4 py-4 text-left">
          <span><span className="block font-bold">Spieler & Teams</span><span className="text-xs text-slate-400">{state.units.length} persönliche Seiten · Status, Spielplan und Benachrichtigungen</span></span>
          <span className="text-sm text-emerald-300">{participantsOpen ? 'Schließen −' : 'Öffnen +'}</span>
        </button>
        {participantsOpen && <div className="space-y-3 border-t border-slate-800 p-4">
          {participantRows.map((row) => <article key={row.unit.id} className={`rounded-xl border p-3 ${row.active?.id === state.currentMatchId ? 'border-red-500/60 bg-red-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-bold">{row.unit.name}</h3>
                {row.unit.kind === 'team' && <div className="text-xs text-slate-400">{row.unit.members.map((member) => member.name).join(' & ')}</div>}
                <div className="mt-1"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${row.active ? 'bg-red-600 text-white' : row.upcoming && row.waitingBefore === 0 ? 'bg-amber-400 text-slate-950' : row.eliminated ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-300'}`}>{row.status}</span></div>
              </div>
              {row.active && <span className="rounded bg-red-500/15 px-2 py-1 text-xs font-bold text-red-200">AKTUELLES SPIEL</span>}
            </div>
            <div className="mt-2 space-y-1 text-sm text-slate-300">
              <div>Aktuell: {row.active ? `${unitName(state, row.active.aUnitId)} vs ${unitName(state, row.active.bUnitId)}` : '—'}</div>
              <div>Nächstes eigenes Spiel: {row.upcoming ? `${unitName(state, row.upcoming.aUnitId)} vs ${unitName(state, row.upcoming.bUnitId)} · ${row.waitingBefore} davor` : row.eliminated ? 'Ausgeschieden' : 'Keines offen'}</div>
              <div>Gegner: {unitName(state, row.opponentId)}</div>
            </div>
            <div className="mt-2 text-xs text-slate-500">{row.current ? `${row.current.label} · ${row.current.stage === 'PRELIMINARY' ? 'Vorrunde' : row.current.stage === 'SEMIFINALS' ? 'Halbfinale' : 'Finale'}` : 'Keine aktive Partie'}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={row.path} target="_blank" rel="noreferrer" className="btn-ghost px-2 py-1 text-xs">Player-Seite öffnen</Link>
              <button className="btn-secondary px-2 py-1 text-xs" onClick={async () => {
                try { await navigator.clipboard.writeText(row.url); setCopiedUnitId(row.unit.id); setTimeout(() => setCopiedUnitId(null), 1800); }
                catch { setFlash('Link konnte nicht kopiert werden.'); }
              }}>{copiedUnitId === row.unit.id ? 'Link kopiert ✓' : 'Link kopieren'}</button>
              <button className="btn-primary px-2 py-1 text-xs" disabled={pingingUnitId === row.unit.id} onClick={async () => {
                setPingingUnitId(row.unit.id);
                try { await api.pingUnit(state.id, row.unit.id); setFlash(`Ping an ${row.unit.name} gesendet`); }
                catch (e) { setFlash(e instanceof Error ? e.message : 'Ping fehlgeschlagen'); }
                finally { setPingingUnitId(null); }
              }}>{pingingUnitId === row.unit.id ? 'Sende…' : 'Ping'}</button>
            </div>
          </article>)}
        </div>}
      </section>

      {/* confirm dialog */}
      {confirmMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md">
            <div className="mb-4 text-sm font-semibold">{confirmMsg.text}</div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirmMsg(null)}>
                Abbrechen
              </button>
              <button
                className="btn-danger"
                onClick={() => {
                  void confirmMsg.action().catch((e) => {
                    setFlash(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
                    setConfirmMsg(null);
                    setTimeout(() => setFlash(null), 4000);
                  });
                }}
              >
                Bestätigen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function nextStageOf(state: TournamentStateDTO): string {
  switch (state.state) {
    case 'SETUP':
      return 'PRELIMINARY';
    case 'PRELIMINARY':
      return 'SEMIFINALS';
    case 'SEMIFINALS':
      return 'FINAL';
    case 'FINAL':
      return 'FINISHED';
    default:
      return 'FINISHED';
  }
}

function OverlaySettingsCard({ state }: { state: TournamentStateDTO }) {
  const [patch, setPatch] = useState<Partial<OverlaySettingsDTO>>(state.settings);
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof OverlaySettingsDTO) => () => {
    const next = { ...patch, [key]: !patch[key] };
    setPatch(next);
    void api.updateOverlaySettings(state.id, { [key]: next[key] } as Partial<OverlaySettingsDTO>).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  };

  const modes: { key: 'auto' | 'next_matches' | 'table' | 'bracket' | 'current_match'; label: string }[] = [
    { key: 'auto', label: 'AUTO' },
    { key: 'next_matches', label: 'Nächste Spiele' },
    { key: 'table', label: 'Tabelle' },
    { key: 'bracket', label: 'Turnierbaum' },
    { key: 'current_match', label: 'Aktuelles Spiel' },
  ];

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">Overlay-Einstellungen</div>
        {saved && <span className="text-xs text-emerald-400">Gespeichert ✓</span>}
      </div>

      <div className="mb-3 flex gap-1">
        {modes.map((m) => (
          <button
            key={m.key}
            onClick={() => void api.setOverlayMode(state.id, m.key)}
            className={`flex-1 rounded px-1 py-1.5 text-[11px] font-bold uppercase ${
              state.settings.overlayMode === m.key ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={patch.autoRotation} onChange={toggle('autoRotation')} />
          Automatische Drehung
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={patch.showLogo} onChange={toggle('showLogo')} />
          Logo anzeigen
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={patch.showTournamentName} onChange={toggle('showTournamentName')} />
          Name anzeigen
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={patch.showFlags} onChange={toggle('showFlags')} />
          Flaggen
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={patch.transparent} onChange={toggle('transparent')} />
          Transparent
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={patch.compact} onChange={toggle('compact')} />
          Kompakt
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="label mb-0">Intervall</label>
        <input
          className="input w-20 table-cell-num"
          inputMode="numeric"
          value={patch.rotationIntervalSec}
          onChange={(e) => {
            const v = Number(e.target.value.replace(/[^0-9]/g, '')) || 30;
            setPatch({ ...patch, rotationIntervalSec: v });
          }}
          onBlur={() => void api.updateOverlaySettings(state.id, { rotationIntervalSec: patch.rotationIntervalSec })}
        />
        <button
          onClick={() =>
            void api
              .updateOverlaySettings(state.id, { theme: state.settings.theme === 'dark' ? 'light' : 'dark' })
              .then(() => setSaved(true))
          }
          className="btn-ghost text-xs"
        >
          Farbschema: {state.settings.theme}
        </button>
      </div>
    </div>
  );
}
