// Player area: each player/team gets a unique, shareable URL.
// Shows that player's status, opponent, phase, and how many games remain before
// their match. Live-updates over SSE. No admin controls.

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { MatchDTO, PlayerViewDTO, TournamentStateDTO } from '@gt/shared';
import { consumeActivationOnce, DISCORD_HELP_TEXT } from '@gt/shared';
import { api, unitName, useTournamentState } from '../lib/api';
import MatchSpotlight, { useResultScreenActive } from '../components/MatchSpotlight';

// ---- tournament notification audio (Web Audio API) -------------------------
let ctx: AudioContext | null = null;
const unlockRequest = { value: false };

// Resume the audio context after the first user interaction (autoplay policy).
async function enableAudio(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    if (!ctx) {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return false;
      ctx = new AudioContextCtor();
    }
    if (ctx.state === 'suspended') await ctx.resume();
    unlockRequest.value = ctx.state === 'running';
    return unlockRequest.value;
  } catch {
    return false;
  }
}

function audioAllowed(): boolean {
  return unlockRequest.value;
}

function playChime() {
  try {
    if (!audioAllowed()) return;
    const c = ctx!;
    const now = c.currentTime;
    // Original, synthesized tournament call: a clear five-second rising/falling fanfare.
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5, 1046.5, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      const start = now + index * 0.48;
      const duration = index === notes.length - 1 ? 0.62 : 0.38;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = index % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.025);
      gain.gain.setValueAtTime(0.2, start + duration * 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  } catch {
    // audio not available — visual state still shows the status
  }
}

function Avatar({ name, imageUrl, size = 'h-16 w-16' }: { name: string; imageUrl: string | null; size?: string }) {
  return imageUrl
    ? <img src={imageUrl} alt={`Profilbild ${name}`} className={`${size} rounded-full border-2 border-slate-700 object-cover`} />
    : <div aria-label={`Kein Profilbild für ${name}`} className={`${size} flex items-center justify-center rounded-full border-2 border-slate-700 bg-slate-800 text-xl font-black text-emerald-300`}>{name.slice(0, 1).toUpperCase()}</div>;
}

// ---- hook: the player's own view, kept alive over SSE ----------------------
export function usePlayerView(id: string, playerId: string): {
  view: PlayerViewDTO | null;
  state: TournamentStateDTO | null;
  error: string | null;
  loading: boolean;
  lastPing: ReturnType<typeof useTournamentState>['lastPing'];
} {
  const { state, error, lastPing } = useTournamentState(id);
  const [view, setView] = useState<PlayerViewDTO | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // initial fetch of the explicit player endpoint
  useEffect(() => {
    let cancelled = false;
    void refresh();

    async function refresh() {
      try {
        const s = await api.getPlayer(id, playerId);
        if (!cancelled) {
          setView(s);
          setViewError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setView(null);
          setViewError(e instanceof Error ? e.message : 'Player not found');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [id, playerId]);

  // live-update: when the tournament state changes over SSE, recompute the
  // player view from the server's playerViews (derived, stable per unit).
  useEffect(() => {
    if (!state) return;
    const v = state.playerViews[playerId] ?? null;
    setView(v);
  }, [state, playerId]);

  return { view, state, error: viewError ?? error, loading, lastPing };
}

// ---- status helpers ---------------------------------------------------------
function stageName(match: MatchDTO): string {
  const stage = match.stage === 'PRELIMINARY' ? 'Vorrunde' : match.stage === 'SEMIFINALS' ? 'Halbfinale' : 'Finale';
  return `${stage}${match.round > 1 ? ` · Runde ${match.round}` : ''}`;
}

function opponent(match: MatchDTO, unitId: string): string | null {
  if (match.aUnitId === unitId) return match.bUnitId;
  if (match.bUnitId === unitId) return match.aUnitId;
  return null;
}

// ---- main component -----------------------------------------------------------
export default function PlayerPage() {
  const { tournamentId, unitId } = useParams<{ tournamentId: string; unitId: string }>();
  const { view, state, error, loading, lastPing } = usePlayerView(tournamentId ?? '', unitId ?? '');
  const resultIsActive = useResultScreenActive(state?.resultScreen?.until, state?.resultScreen?.matchId);

  const seenActivations = useRef(new Set<string>());
  const [audioOn, setAudioOn] = useState(false);
  const [pingMessage, setPingMessage] = useState<string | null>(null);
  const [sendingReadiness, setSendingReadiness] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [problemText, setProblemText] = useState('');
  const [problemBusy, setProblemBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Resolve a unit's display name using the tournament's unit list. */
  const unitNameFromState = (unitId: string | null): string => {
    if (!unitId) return '—';
    if (state) {
      const u = state.units.find((x) => x.id === unitId);
      if (u) return u.name;
    }
    return unitId;
  };
  useEffect(() => {
    if (!lastPing || lastPing.unitId !== unitId || !consumeActivationOnce(lastPing.activationId, seenActivations.current)) return;
    setPingMessage(lastPing.reason === 'manual' ? 'Der Turnier-Admin hat dich angepingt.' : 'Du bist jetzt dran — dein Spiel startet!');
    const timeout = window.setTimeout(() => setPingMessage(null), 10000);
    if (audioOn) playChime();
    return () => window.clearTimeout(timeout);
  }, [lastPing, unitId, audioOn]);

  useEffect(() => {
    const unlock = () => { void enableAudio().then(setAudioOn); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  if (state?.presentation.active) {
    const deck = state.presentation.decks.find((item) => item.id === state.presentation.activeDeckId) ?? state.presentation.decks[0];
    const slide = deck?.slides[state.presentation.currentIndex];
    return slide ? <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 sm:p-8"><section className="flex min-h-[80vh] w-full max-w-5xl flex-col items-center justify-center rounded-3xl border border-emerald-400/30 bg-slate-900 p-6 text-center shadow-2xl sm:p-12">
      <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-300">{deck?.title} · {state.presentation.currentIndex + 1}/{deck.slides.length}</div>
      <h1 className="mt-8 text-3xl font-black sm:text-5xl">{slide.title}</h1>
      <p className="mt-6 max-w-3xl whitespace-pre-wrap text-lg leading-relaxed text-slate-200 sm:text-2xl">{slide.text}</p>
      {slide.imageUrl && <img src={slide.imageUrl} alt="" className="mt-6 max-h-[35vh] max-w-full rounded-xl object-contain" />}
    </section></main> : <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-center text-slate-200">Die Präsentation enthält keine Folien. Bitte den Admin informieren.</div>;
  }

  if (resultIsActive && state?.resultScreen) {
    const resultMatch = state.matches.find((match) => match.id === state.resultScreen?.matchId);
    if (resultMatch) return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-3 sm:p-8"><MatchSpotlight state={state} match={resultMatch} /></main>;
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <div className="mt-3 text-sm text-slate-400">Laden…</div>
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center text-red-400">
        {error}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center text-slate-400">
        Spiel nicht gefunden.
      </div>
    );
  }

  const { name, kind, memberNames, status, gamesBeforeNext, nextOwnMatch, ownMatches, groups } = view;
  const ownUnit = state?.units.find((unit) => unit.id === view.playerId);
  const ownRank = state ? (state.groups.length
    ? state.groupStandings[state.groups.find((group) => group.unitIds.includes(view.playerId))?.id ?? '']?.find((row) => row.unitId === view.playerId)?.position ?? null
    : state.standings.find((row) => row.unitId === view.playerId)?.position ?? null) : null;
  const report = ownUnit?.problemReport ?? null;
  const displayStatus = status === 'dran' ? 'DU BIST DRAN' : status === 'eliminated' ? 'AUSGESCHIEDEN' : view.readiness === 'in_game' ? 'IN GEOGUESSR' : view.readiness === 'ready' ? 'BEREIT' : status === 'next' ? 'ALS NÄCHSTES DRAN' : status === 'played' ? 'SPIELE BEENDET' : 'WARTET';
  const submitReadiness = async (readiness: 'ready' | 'in_game') => {
    if (!tournamentId || !view) return;
    setSendingReadiness(true);
    setActionError(null);
    try { await api.setReadiness(tournamentId, view.playerId, readiness); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Status konnte nicht gespeichert werden'); }
    finally { setSendingReadiness(false); }
  };
  const submitProblem = async () => {
    if (!tournamentId || !view || !problemText.trim()) return;
    setProblemBusy(true);
    setActionError(null);
    try { await api.reportProblem(tournamentId, view.playerId, problemText.trim()); setProblemOpen(false); setProblemText(''); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Meldung konnte nicht gesendet werden'); }
    finally { setProblemBusy(false); }
  };
  const ordered = [...ownMatches].sort((a, b) =>
    (a.stage === 'PRELIMINARY' ? 0 : a.stage === 'SEMIFINALS' ? 1 : 2) -
    (b.stage === 'PRELIMINARY' ? 0 : b.stage === 'SEMIFINALS' ? 1 : 2) || a.orderInStage - b.orderInStage,
  );
  const gamesRemaining = gamesBeforeNext;

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-6 sm:py-10">
      {/* header / share link (mobile friendly) */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">{name}</h1>
          <div className="text-xs text-slate-500">
            {kind === 'team' ? memberNames.join(' & ') : 'Persönliche Turnierseite'}
            {groups.length > 0 && <span className="ml-2 text-xs font-semibold uppercase text-emerald-400">{groups[0].name}</span>}
          </div>
        </div>
        <button className="btn-ghost text-xs" onClick={() => {
            if (!navigator.clipboard?.writeText) return;
            navigator.clipboard.writeText(window.location.href).then(() => setPingMessage('Link kopiert.')).catch(() => setPingMessage('Link konnte nicht kopiert werden.'));
          }}
          title="Link kopieren"
        >
          Teilen ↗
        </button>
      </div>

      {ownUnit && <div className="mt-5 flex items-center justify-center gap-3" aria-label={kind === 'team' ? 'Teammitglieder' : 'Spielerbild'}>
        {(kind === 'team' ? ownUnit.members : ownUnit.members.slice(0, 1)).map((member) => <Avatar key={member.id} name={member.name} imageUrl={member.imageUrl} size="h-16 w-16" />)}
      </div>}

      {/* prominent status: recognizable immediately on mobile */}
      <section aria-live="polite" className={`mt-5 rounded-2xl border p-5 text-center ${status === 'dran' ? 'border-red-500/70 bg-red-600/15' : status === 'next' ? 'border-amber-500/60 bg-amber-500/10' : status === 'eliminated' ? 'border-slate-700 bg-slate-900' : 'border-slate-800 bg-slate-900/70'}`}>
        <div className={`text-sm font-black tracking-wide ${status === 'dran' ? 'text-red-300' : status === 'next' ? 'text-amber-300' : 'text-slate-200'}`}>
          {displayStatus}
        </div>
        {ownRank !== null && <p className="mt-1 text-xs text-slate-400">Aktueller Rang: {ownRank}. Platz</p>}
        {status === 'waiting' && <p className="mt-1 text-sm text-slate-400">Du bist im Spielplan eingeordnet.</p>}
        {pingMessage && <p role="status" className="mt-3 rounded-lg bg-red-500/20 px-3 py-2 font-bold text-red-200">{pingMessage}</p>}
        {status === 'next' && <p className="mt-2 text-xs text-amber-200">Dein Spiel ist das nächste in der Reihenfolge.</p>}
        {status === 'dran' && nextOwnMatch && <div className="mt-3 text-xl font-black text-red-100">{unitNameFromState(nextOwnMatch.aUnitId)} <span className="text-red-300">vs</span> {unitNameFromState(nextOwnMatch.bUnitId)}</div>}
      </section>

      <section className="mt-4 rounded-xl border border-emerald-700/40 bg-slate-900/70 p-4" aria-label="Bereitschaft">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">Deine Bereitschaft</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button disabled={sendingReadiness || status === 'eliminated' || !nextOwnMatch} onClick={() => void submitReadiness('ready')} className={view.readiness === 'ready' ? 'btn-primary py-3' : 'btn-secondary py-3'}>ICH BIN BEREIT</button>
          <button disabled={sendingReadiness || status === 'eliminated' || !nextOwnMatch} onClick={() => void submitReadiness('in_game')} className={view.readiness === 'in_game' ? 'btn-primary py-3' : 'btn-secondary py-3'}>ICH BIN IN GEOGUESSR</button>
        </div>
        {actionError && <p role="alert" className="mt-2 text-sm text-red-300">{actionError}</p>}
        <p className="mt-2 text-xs text-slate-500">Dieser Status ändert den Turnier- oder Spielstand nicht.</p>
      </section>

      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Benachrichtigungen</div>
            <div className="text-xs text-slate-400">Visuelle Hinweise funktionieren immer; Ton nur nach Aktivierung.</div>
          </div>
          <button className={audioOn ? 'btn-secondary' : 'btn-primary'} onClick={async () => {
            const enabled = await enableAudio();
            setAudioOn(enabled);
            if (!enabled) setPingMessage('Audio ist nicht verfügbar; visuelle Hinweise bleiben aktiv.');
          }}>
            {audioOn ? 'Ton aktiviert' : 'Ton aktivieren'}
          </button>
        </div>
      </section>

      {report && <section aria-live="polite" className={`mt-4 rounded-xl border p-3 ${report.resolved ? 'border-slate-800 bg-slate-900/50' : 'border-amber-500/50 bg-amber-500/10'}`}>
        <div className="text-xs font-bold uppercase tracking-wider text-amber-300">{report.resolved ? 'Problemmeldung erledigt' : 'Deine Problemmeldung wurde gesendet'}</div>
        <p className="mt-1 text-sm">{report.message}</p><p className="mt-2 text-xs text-slate-400">{DISCORD_HELP_TEXT}</p>
      </section>}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <button className="btn-danger w-full" onClick={() => setProblemOpen((open) => !open)}>{report && !report.resolved ? 'PROBLEM / HILFE · ERNEUT MELDEN' : 'PROBLEM / HILFE'}</button>
        {problemOpen && <div className="mt-3 space-y-2">
          <label className="label" htmlFor="problem-message">Was ist das Problem?</label>
          <textarea id="problem-message" className="input min-h-24" maxLength={300} value={problemText} onChange={(event) => setProblemText(event.target.value)} placeholder="z. B. Ich kann das GeoGuessr-Spiel nicht öffnen." />
          <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-500">{problemText.length}/300</span><button className="btn-primary" disabled={problemBusy || !problemText.trim()} onClick={() => void submitProblem()}>{problemBusy ? 'Wird gesendet…' : 'HILFE ANFORDERN'}</button></div>
          <p className="text-xs text-slate-400">{DISCORD_HELP_TEXT}</p>
        </div>}
      </section>

      {nextOwnMatch && state && <section className={`mt-4 rounded-2xl border p-4 ${status === 'dran' ? 'border-red-500/60 bg-red-600/10' : status === 'next' ? 'border-amber-500/50 bg-amber-500/5' : 'bg-slate-900/70'}`}>
        <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">{status === 'dran' ? 'Dein aktuelles Spiel' : 'Dein nächstes Spiel'}</div>
        <div className="my-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center text-lg font-black">
          <span className="truncate">{unitName(state, nextOwnMatch.aUnitId)}</span><span className="text-xs text-slate-500">VS</span><span className="truncate">{unitName(state, nextOwnMatch.bUnitId)}</span>
        </div>
        <div className="text-xs text-slate-400">{stageName(nextOwnMatch)} · {nextOwnMatch.label} · Position {state.matches.findIndex((match) => match.id === nextOwnMatch.id) + 1}{groups[0] ? ` · ${groups[0].name}` : ''}{status === 'waiting' ? ` · ${gamesRemaining} Spiel${gamesRemaining === 1 ? '' : 'e'} davor` : ''}</div>
        <div className="mt-1 text-sm text-slate-300">Gegner: <strong>{unitName(state, opponent(nextOwnMatch, view.playerId))}</strong></div>
      </section>}

      {state && <div className="mt-6 space-y-5">
        {state.groups.length > 0 && state.groups.map((group) => {
          const isOwnGroup = group.unitIds.includes(view.playerId);
          const fixtures = state.matches.filter((match) => match.stage === 'PRELIMINARY' && group.unitIds.includes(match.aUnitId ?? '') && group.unitIds.includes(match.bUnitId ?? ''));
          return <MatchSection key={group.id} title={isOwnGroup ? 'Deine Gruppe' : `Andere Gruppe · ${group.name}`} matches={fixtures} ownUnitId={view.playerId} state={state} />;
        })}
        <MatchSection title="Deine Spiele · Ergebnisse & kommende Partien" matches={ordered} ownUnitId={view.playerId} state={state} />
      </div>}

      {/* note: this is your personal page, no admin tools here */}
      <div className="mt-6 text-center text-xs text-slate-600">
        Deine Live-Ansicht — ohne Admin-Rechte. Updates kommen sofort per Live-Update. <Link to={`/rules?turnier=${encodeURIComponent(state?.id ?? tournamentId ?? '')}`} className="ml-1 text-emerald-300 underline">Turnierregeln</Link>
      </div>
    </main>
  );
}

function MatchSection({ title, matches, ownUnitId, state }: {
  title: string;
  matches: MatchDTO[];
  ownUnitId: string;
  state: TournamentStateDTO;
}) {
  if (!matches.length) return null;
  return <section className="space-y-2" aria-label={title}>
    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h2>
    {matches.map((match) => {
      const mine = match.aUnitId === ownUnitId || match.bUnitId === ownUnitId;
      return <article key={match.id} className={`rounded-xl border p-3 ${match.status === 'live' ? 'border-red-500/70 bg-red-500/10' : match.status === 'finished' ? 'border-slate-800 bg-slate-900/40 opacity-75' : 'border-slate-800 bg-slate-900/70'} ${mine ? 'ring-1 ring-emerald-500/30' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>{match.label} · {stageName(match)}</span>
          <span className={match.status === 'live' ? 'font-bold text-red-300' : match.status === 'finished' ? 'font-semibold text-emerald-400' : ''}>{match.status === 'live' ? 'LIVE' : match.status === 'finished' ? 'Gespielt' : 'Kommend'}</span>
        </div>
        <div className="mt-1 font-semibold text-slate-100">{unitName(state, match.aUnitId)} <span className="text-slate-500">vs</span> {unitName(state, match.bUnitId)}</div>
        {match.result && <div className="mt-1 text-xs text-slate-400">Ergebnis {match.result.aDamageDealt} – {match.result.bDamageDealt} · Sieger: <span className="font-semibold text-emerald-300">{unitName(state, match.result.winnerUnitId)}</span></div>}
      </article>;
    })}
  </section>;
}
