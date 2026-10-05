// Player area: each player/team gets a unique, shareable URL.
// Shows that player's status, opponent, phase, and how many games remain before
// their match. Live-updates over SSE. No admin controls.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { MatchDTO, PlayerViewDTO, PlayerStatus, TournamentStateDTO } from '@gt/shared';
import { consumeActivationOnce } from '@gt/shared';
import { api, unitName, useTournamentState } from '../lib/api';

// ---- tiny audio helper (web audio beep) -------------------------------------
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
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch {
    // audio not available — visual state still shows the status
  }
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

  const seenActivations = useRef(new Set<string>());
  const [audioOn, setAudioOn] = useState(false);
  const [pingMessage, setPingMessage] = useState<string | null>(null);

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

      {/* prominent status: recognizable immediately on mobile */}
      <section aria-live="polite" className={`mt-5 rounded-2xl border p-5 text-center ${status === 'dran' ? 'border-red-500/70 bg-red-600/15' : status === 'next' ? 'border-amber-500/60 bg-amber-500/10' : status === 'eliminated' ? 'border-slate-700 bg-slate-900' : 'border-slate-800 bg-slate-900/70'}`}>
        <div className={`text-sm font-black tracking-wide ${status === 'dran' ? 'text-red-300' : status === 'next' ? 'text-amber-300' : 'text-slate-200'}`}>
          {status === 'dran' ? 'DU BIST JETZT DRAN' : status === 'next' ? 'DU BIST ALS NÄCHSTES DRAN' : status === 'waiting' ? `NOCH ${gamesRemaining} SPIEL${gamesRemaining === 1 ? '' : 'E'} BIS DU DRAN BIST` : status === 'eliminated' ? 'DU BIST AUSGESCHIEDEN' : status === 'played' ? 'DEINE SPIELE SIND BEENDET' : 'DU WARTEST'}
        </div>
        {status === 'waiting' && <p className="mt-1 text-sm text-slate-400">Du bist im Spielplan eingeordnet.</p>}
        {pingMessage && <p role="status" className="mt-3 rounded-lg bg-red-500/20 px-3 py-2 font-bold text-red-200">{pingMessage}</p>}
        {status === 'next' && <p className="mt-2 text-xs text-amber-200">Dein Spiel ist das nächste in der Reihenfolge.</p>}
        {status === 'dran' && nextOwnMatch && <div className="mt-3 text-xl font-black text-red-100">{unitNameFromState(nextOwnMatch.aUnitId)} <span className="text-red-300">vs</span> {unitNameFromState(nextOwnMatch.bUnitId)}</div>}
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

      {nextOwnMatch && state && <section className={`mt-4 rounded-2xl border p-4 ${status === 'dran' ? 'border-red-500/60 bg-red-600/10' : status === 'next' ? 'border-amber-500/50 bg-amber-500/5' : 'bg-slate-900/70'}`}>
        <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">{status === 'dran' ? 'Dein aktuelles Spiel' : 'Dein nächstes Spiel'}</div>
        <div className="my-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center text-lg font-black">
          <span className="truncate">{unitName(state, nextOwnMatch.aUnitId)}</span><span className="text-xs text-slate-500">VS</span><span className="truncate">{unitName(state, nextOwnMatch.bUnitId)}</span>
        </div>
        <div className="text-xs text-slate-400">{stageName(nextOwnMatch)} · {nextOwnMatch.label} · Position {state.matches.findIndex((match) => match.id === nextOwnMatch.id) + 1}{groups[0] ? ` · ${groups[0].name}` : ''}{status === 'waiting' ? ` · ${gamesRemaining} Spiel${gamesRemaining === 1 ? '' : 'e'} davor` : ''}</div>
        <div className="mt-1 text-sm text-slate-300">Gegner: <strong>{unitName(state, opponent(nextOwnMatch, view.playerId))}</strong></div>
      </section>}

      {state && (state.groups.length > 0 || state.state !== 'PRELIMINARY') && <div className="mt-6 space-y-5">
        {state.groups.length > 0 && state.groups.map((group) => {
          const isOwnGroup = group.unitIds.includes(view.playerId);
          const fixtures = state.matches.filter((match) => match.stage === 'PRELIMINARY' && group.unitIds.includes(match.aUnitId ?? '') && group.unitIds.includes(match.bUnitId ?? ''));
          return <MatchSection key={group.id} title={isOwnGroup ? 'Deine Gruppe' : `Andere Gruppe · ${group.name}`} matches={fixtures} ownUnitId={view.playerId} state={state} />;
        })}
        <MatchSection title={state.groups.length ? 'Deine K.-o.-Spiele' : 'Deine Spiele · Ergebnisse & kommende Partien'} matches={state.groups.length ? ordered.filter((match) => match.stage !== 'PRELIMINARY') : ordered} ownUnitId={view.playerId} state={state} />
      </div>}

      {/* note: this is your personal page, no admin tools here */}
      <div className="mt-6 text-center text-xs text-slate-600">
        Deine Live-Ansicht — ohne Admin-Rechte. Updates kommen sofort per Live-Update.
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
