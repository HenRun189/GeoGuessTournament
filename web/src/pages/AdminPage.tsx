// Moderator panel: tournament flow control + fast result entry.

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TournamentStateDTO, OverlaySettingsDTO } from '@gt/shared';
import { api, unitName, useTournamentState } from '../lib/api';
import StandingsTable from '../components/StandingsTable';
import MatchList from '../components/MatchList';
import ResultEntry from '../components/ResultEntry';
import Bracket from '../components/Bracket';
import PresentationEditor from '../components/PresentationEditor';
import { DEFAULT_PRESENTATION_DECKS, type PresentationDeckDTO, type UnitDTO } from '@gt/shared';
import { useAdminAuth } from '../main';

const STATE_LABELS: Record<string, string> = {
  SETUP: 'Einrichten',
  PRELIMINARY: 'Vorrunde',
  SEMIFINALS: 'Halbfinale',
  FINAL: 'Finale',
  FINISHED: 'Beendet',
};

export default function AdminPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state, error, connected, refresh } = useTournamentState(id ?? null);
  const globalAdmin = useAdminAuth();
  const activeDeck = state?.presentation.decks.find((deck) => deck.id === state.presentation.activeDeckId) ?? state?.presentation.decks[0];
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<{ text: string; action: () => Promise<void> } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [copiedUnitId, setCopiedUnitId] = useState<string | null>(null);
  const [pingingUnitId, setPingingUnitId] = useState<string | null>(null);
  const [presentationDecks, setPresentationDecks] = useState<PresentationDeckDTO[]>([]);
  const [loadedDeckTournamentId, setLoadedDeckTournamentId] = useState<string | null>(null);
  const decksLoaded = state !== null && loadedDeckTournamentId === state.id;
  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);
  const problemAlertIds = useRef(new Set<string>());
  const openProblemCount = useRef(0);
  const alertAudioContext = useRef<AudioContext | null>(null);
  const unlockedAdminAudio = useRef(false);

  useEffect(() => {
    if (globalAdmin.status === 'authenticated') void refresh();
  }, [globalAdmin.status, id, refresh]);

  const adminAccess = globalAdmin.status === 'authenticated' ? 'granted' : globalAdmin.status === 'checking' ? 'checking' : 'denied';

  useEffect(() => {
    if (adminAccess !== 'granted' || !state || loadedDeckTournamentId === state.id) return;
    const decks = state.presentation.decks.length ? state.presentation.decks : DEFAULT_PRESENTATION_DECKS;
    setPresentationDecks(JSON.parse(JSON.stringify(decks)) as PresentationDeckDTO[]);
    setSavedDeckId(activeDeck?.id ?? null);
    setLoadedDeckTournamentId(state.id);
  }, [adminAccess, state?.id, state?.presentation.decks, activeDeck?.id, loadedDeckTournamentId]);

  useEffect(() => {
    if (adminAccess !== 'granted' || !state) return;
    const openProblems = participantRowsForAlerts(state.units);
    openProblemCount.current = openProblems.length;
    const openKeys = new Set(openProblems.map((unit) => `${unit.id}:${unit.problemReport?.createdAt}`));
    const fresh = [...openKeys].filter((key) => !problemAlertIds.current.has(key));
    if (fresh.length && unlockedAdminAudio.current) playAdminAlert(alertAudioContext);
    fresh.forEach((key) => problemAlertIds.current.add(key));
    for (const key of problemAlertIds.current) {
      if (!openKeys.has(key)) problemAlertIds.current.delete(key);
    }
  }, [adminAccess, state?.units]);

  const enableProblemAudio = async () => {
    try {
      const context = alertAudioContext.current ?? new AudioContext();
      alertAudioContext.current = context;
      if (context.state === 'suspended') await context.resume();
      unlockedAdminAudio.current = context.state === 'running';
      if (unlockedAdminAudio.current && openProblemCount.current > 0) playAdminAlert(alertAudioContext);
      setFlash(unlockedAdminAudio.current ? 'Problemton aktiviert.' : 'Audio ist nicht verfügbar.');
    } catch { setFlash('Audio ist nicht verfügbar.'); }
  };

  useEffect(() => {
    if (adminAccess !== 'granted' || !state?.presentation.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void api.setPresentationActive(state.id, false);
      else if (event.key === 'ArrowLeft') void api.navigatePresentation(state.id, -1);
      else if (event.key === 'ArrowRight') void api.navigatePresentation(state.id, 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [adminAccess, state?.id, state?.presentation.active]);

  if (adminAccess === 'checking') return <main className="mx-auto max-w-xl px-4 py-10 text-center text-slate-400">Admin-Zugang wird geprüft…</main>;
  if (adminAccess !== 'granted') return <main className="mx-auto max-w-xl px-4 py-10"><Link to="/" className="btn-ghost mb-5">← Startseite</Link><section className="card"><h1 className="mb-2 text-2xl font-black">Admin-Anmeldung erforderlich</h1><p className="text-sm text-slate-400">Melde dich über „Admin-Login“ im oberen Menü an, um dieses Turnier zu verwalten.</p></section></main>;

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
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost text-xs" onClick={() => void enableProblemAudio()}>Problemton aktivieren</button>
          <Link to={`/rules?turnier=${encodeURIComponent(state.id)}`} className="btn-ghost text-xs">Regeln</Link>
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
      {participantRows.filter((row) => row.unit.problemReport && !row.unit.problemReport.resolved).map((row) => {
        const problem = row.unit.problemReport;
        if (!problem) return null;
        return <section key={row.unit.id} role="alert" aria-live="assertive" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-400 bg-amber-950/80 px-4 py-3 text-amber-50 shadow-lg shadow-amber-950/40"><div><div className="font-black uppercase tracking-wide">PROBLEM: {row.unit.name}</div>{row.unit.kind === 'team' && <div className="text-sm">{row.unit.members.map((member) => member.name).join(' & ')}</div>}<div className="mt-1 text-sm">{problem.message}</div></div><button className="btn-secondary" onClick={() => void api.resolveProblem(state.id, row.unit.id).then(() => setFlash('Problemmeldung als erledigt markiert.')).catch((error) => setFlash(error instanceof Error ? error.message : 'Aktion fehlgeschlagen'))}>Als erledigt markieren</button></section>;
      })}

      {(state.presentation.active || state.presentationVideo?.active) && <div className="fixed inset-x-0 bottom-4 z-40 flex flex-wrap items-center justify-center gap-2 px-4">{state.presentation.active && <><button className="btn-secondary shadow-lg" onClick={() => void api.navigatePresentation(state.id, -1)}>← ZURÜCK</button><span className="rounded-lg bg-slate-950/95 px-3 py-2 text-sm font-bold text-white">Folie {state.presentation.currentIndex + 1} / {activeDeck?.slides.length ?? 0}</span><button className="btn-secondary shadow-lg" onClick={() => void api.navigatePresentation(state.id, 1)}>WEITER →</button><button className="btn-danger shadow-lg" onClick={() => void api.setPresentationActive(state.id, false)}>PRÄSENTATION BEENDEN</button></>}{state.presentationVideo?.active && <button className="btn-danger shadow-lg" onClick={() => void api.setPresentationVideoActive(state.id, false)}>MP4 STOPPEN</button>}</div>}

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
            {editingMatchId ? (
              <div><div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-300">{state.matches.find((match) => match.id === editingMatchId)?.status === 'finished' ? 'Ergebnis bearbeiten' : 'Ergebnis eingeben'}</div><ResultEntry key={editingMatchId} matchId={editingMatchId} state={state} editing={state.matches.find((match) => match.id === editingMatchId)?.status === 'finished'} onSaved={() => { setEditingMatchId(null); void refresh(); }} /></div>
            ) : state.currentMatchId ? (
              <ResultEntry matchId={state.currentMatchId} state={state} onSaved={() => void refresh()} />
            ) : (
              <div className="text-sm text-slate-500">
                Kein aktuelles Spiel ausgewählt. Ein beliebiges kommendes Spiel unten mit „JETZT SPIELEN“ sofort aktivieren →
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
                if (state.matches.find((match) => match.id === mid)?.status !== 'finished') void act(() => api.setCurrentMatch(state.id, mid))();
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
                  <StandingsTable key={g.id} title={g.name} rows={state.groupStandings[g.id] ?? []} showFlags state={state} />
                ))}
                <div className="border-t border-slate-800 pt-2">
                  <StandingsTable rows={state.standings} title="Gesamt" showFlags state={state} />
                </div>
              </div>
            ) : (
              <StandingsTable rows={state.standings} showFlags state={state} />
            )}
          </div>

          {/* bracket */}
          <div className="card">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">Turnierbaum</div>
            <Bracket state={state} />
          </div>

          {/* overlay settings */}
          <OverlaySettingsCard state={state} />
          <PresentationEditor
            state={state}
            decks={presentationDecks}
            setDecks={setPresentationDecks}
            decksLoaded={decksLoaded}
            onSave={async () => { await api.updatePresentationDecks(state.id, presentationDecks); setFlash('Präsentationen gespeichert.'); }}
            onStart={async (deckId) => {
              try {
                const context = alertAudioContext.current ?? new AudioContext();
                alertAudioContext.current = context;
                if (context.state === 'suspended') await context.resume();
                unlockedAdminAudio.current = context.state === 'running';
              } catch { unlockedAdminAudio.current = false; }
              await api.updatePresentationDecks(state.id, presentationDecks);
              await api.selectPresentationDeck(state.id, deckId);
              await api.setPresentationActive(state.id, true);
            }}
            onSelect={(deckId) => { setSavedDeckId(deckId); if (state.presentation.decks.some((deck) => deck.id === deckId)) void api.selectPresentationDeck(state.id, deckId); }}
            selectedDeckId={savedDeckId ?? state.presentation.activeDeckId}
            active={state.presentation.active}
            video={state.presentationVideo}
            onUploadVideo={async (file) => { await api.uploadPresentationVideo(state.id, file); }}
            onSetVideoActive={async (active) => { await api.setPresentationVideoActive(state.id, active); }}
            onDeleteDeck={async (deckId) => {
              const nextDecks = presentationDecks.filter((deck) => deck.id !== deckId);
              setPresentationDecks(nextDecks);
              await api.updatePresentationDecks(state.id, nextDecks);
              const selected = nextDecks[0];
              if (selected) { setSavedDeckId(selected.id); await api.selectPresentationDeck(state.id, selected.id); }
            }}
          />
        </div>
      </div>

      <section className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
        <button type="button" aria-expanded={participantsOpen} onClick={() => setParticipantsOpen((open) => !open)} className="flex w-full items-center justify-between px-4 py-4 text-left">
          <span><span className="block font-bold">Spieler & Teams</span><span className="text-xs text-slate-400">{state.units.length} persönliche Seiten · Bereitschaft, Hilfe, Bilder und Live-Status</span></span>
          <span className="text-sm text-emerald-300">{participantsOpen ? 'Schließen −' : 'Öffnen +'}</span>
        </button>
        {participantsOpen && <div className="space-y-3 border-t border-slate-800 p-4">
          {participantRows.map((row) => <article key={row.unit.id} className={`rounded-xl border p-3 ${row.active?.id === state.currentMatchId ? 'border-red-500/60 bg-red-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">{row.unit.members.map((member) => member.imageUrl ? <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-8 w-8 rounded-full border-2 border-slate-900 object-cover" /> : <span key={member.id} title={member.name} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-800 text-xs font-bold">{member.name.slice(0, 1)}</span>)}</div>
                  <h3 className="font-bold">{row.unit.name}</h3>
                </div>
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded px-2 py-0.5 font-bold ${row.active ? 'bg-red-600 text-white' : row.eliminated ? 'bg-slate-700 text-slate-300' : row.unit.readiness === 'in_game' ? 'bg-emerald-500/20 text-emerald-200' : row.unit.readiness === 'ready' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}>{row.active ? 'DU BIST DRAN' : row.eliminated ? 'AUSGESCHIEDEN' : row.unit.readiness === 'in_game' ? 'IN GEOGUESSR' : row.unit.readiness === 'ready' ? 'BEREIT' : 'WARTET'}</span>
                  {row.unit.readiness === 'ready' && <span className="text-emerald-300">Bereit ✓</span>}
                  {row.unit.readiness === 'in_game' && <span className="text-emerald-200">Im Spiel ✓</span>}
                  {row.unit.readiness !== 'waiting' && row.upcoming && <button className="btn-ghost px-2 py-0.5 text-[10px]" onClick={() => void api.setReadiness(state.id, row.unit.id, 'waiting').catch((cause) => setFlash(cause instanceof Error ? cause.message : 'Status konnte nicht zurückgesetzt werden'))}>Status zurücksetzen</button>}
                </div>
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
            {row.unit.problemReport && <div className={`mt-3 rounded-lg border p-3 text-sm ${row.unit.problemReport.resolved ? 'border-slate-700 bg-slate-900/70 text-slate-300' : 'border-amber-500/50 bg-amber-500/10 text-amber-100'}`}>
              <div className="font-bold">{row.unit.problemReport.resolved ? 'Erledigte Problemmeldung' : `${row.unit.name} hat ein Problem`}</div>
              <p className="mt-1">{row.unit.problemReport.message}</p>
              {!row.unit.problemReport.resolved && <button className="btn-secondary mt-2 px-2 py-1 text-xs" onClick={async () => { try { await api.resolveProblem(state.id, row.unit.id); setFlash('Problemmeldung als erledigt markiert.'); } catch (e) { setFlash(e instanceof Error ? e.message : 'Aktion fehlgeschlagen'); } }}>Als erledigt markieren</button>}
            </div>}
            <div className="mt-3 space-y-2">
              {row.unit.members.map((member) => <div key={member.id} className="flex flex-wrap items-center gap-2 rounded bg-slate-900/60 p-2">
                {member.imageUrl ? <img src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-10 w-10 rounded-full object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-sm font-bold">{member.name.slice(0, 1)}</div>}
                <span className="min-w-24 flex-1 text-sm">{member.name}</span>
                <label className="btn-secondary cursor-pointer px-2 py-1 text-xs">{member.imageUrl ? 'Bild ändern' : 'Bild hochladen'}<input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
                  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                  if (file.size > 4 * 1024 * 1024) { setFlash('Bild darf höchstens 4 MB groß sein.'); return; }
                  try { const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden')); reader.readAsDataURL(file); }); await api.uploadParticipantImage(state.id, member.id, file.type, data); setFlash('Profilbild gespeichert.'); }
                  catch (e) { setFlash(e instanceof Error ? e.message : 'Bild konnte nicht gespeichert werden'); }
                }} /></label>
                {member.imageUrl && <button className="btn-ghost px-2 py-1 text-xs" onClick={async () => { try { await api.removeParticipantImage(state.id, member.id); setFlash('Profilbild entfernt.'); } catch (e) { setFlash(e instanceof Error ? e.message : 'Bild konnte nicht entfernt werden'); } }}>Entfernen</button>}
              </div>)}
            </div>
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

function participantRowsForAlerts(units: UnitDTO[]): UnitDTO[] {
  return units.filter((unit) => unit.problemReport && !unit.problemReport.resolved);
}

function playAdminAlert(contextRef: MutableRefObject<AudioContext | null>): void {
  try {
    const context = contextRef.current;
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    [880, 1174.66, 880].forEach((frequency, index) => {
      const start = now + index * 0.2;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.19);
    });
  } catch { /* keep the visual admin alert available if audio is blocked */ }
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
  useEffect(() => { setPatch(state.settings); }, [state.settings]);

  const toggle = (key: keyof OverlaySettingsDTO) => () => {
    const next = { ...patch, [key]: !patch[key] };
    setPatch(next);
    void api.updateOverlaySettings(state.id, { [key]: next[key] } as Partial<OverlaySettingsDTO>).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  };

  const modes: { key: OverlaySettingsDTO['overlayMode']; label: string }[] = [
    { key: 'auto', label: 'AUTO' },
    { key: 'next_matches', label: 'Nächste Spiele' },
    { key: 'all_matches', label: 'Alle Spiele' },
    { key: 'table', label: 'Tabelle' },
    { key: 'bracket', label: 'Turnierbaum' },
    { key: 'current_match', label: 'Aktuelles Spiel' },
    { key: 'result_screen', label: 'Ergebnis' },
    { key: 'presentation', label: 'Präsentation' },
  ];

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">Overlay-Einstellungen</div>
        {saved && <span className="text-xs text-emerald-400">Gespeichert ✓</span>}
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
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

      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-300">Ansichten für die automatische Drehung</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {([
            ['next_matches', 'Nächste Spiele'],
            ['all_matches', 'Alle Spiele'],
            ['table', 'Tabelle'],
            ['bracket', 'Turnierbaum'],
            ['current_match', 'Aktuelles Spiel'],
            ['presentation', 'Präsentation'],
          ] as const).map(([key, label]) => {
            const selected = patch.rotationViews?.includes(key) ?? false;
            return <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={selected} onChange={() => {
              const current = patch.rotationViews ?? state.settings.rotationViews;
              const rotationViews = current.includes(key) ? current.filter((view) => view !== key) : [...current, key];
              if (!rotationViews.length) return;
              setPatch({ ...patch, rotationViews });
              void api.updateOverlaySettings(state.id, { rotationViews }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); });
            }} />{label}</label>;
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="label mb-0">Wechsel alle</label>
        <input
          className="input w-20 table-cell-num"
          inputMode="numeric"
          value={patch.rotationIntervalSec}
          onChange={(e) => {
            const v = Number(e.target.value.replace(/[^0-9]/g, '')) || 30;
            setPatch({ ...patch, rotationIntervalSec: v });
          }}
          onBlur={() => void api.updateOverlaySettings(state.id, { rotationIntervalSec: patch.rotationIntervalSec }).then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })}
        />
        <span className="text-xs text-slate-400">Sekunden</span>
      </div>
    </div>
  );
}
