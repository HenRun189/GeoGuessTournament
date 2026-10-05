// OBS overlay: transparent, auto-rotating views (next matches / table / bracket / current match).

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { TournamentStateDTO, OverlayView } from '@gt/shared';
import { unitName, useTournamentState } from '../lib/api';
import StandingsTable, { flagEmoji } from '../components/StandingsTable';
import Bracket from '../components/Bracket';
import MatchSpotlight, { useResultScreenActive } from '../components/MatchSpotlight';

const STAGE_LABELS: Record<string, string> = {
  PRELIMINARY: 'Vorrunde',
  SEMIFINALS: 'Halbfinale',
  FINAL: 'Finale',
};

export default function OverlayPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useTournamentState(id ?? null);
  const [tick, setTick] = useState(0);
  const resultIsActive = useResultScreenActive(state?.resultScreen?.until, state?.resultScreen?.matchId);

  useEffect(() => {
    if (!state || !state.settings.autoRotation || state.settings.overlayMode !== 'auto') return;
    const interval = Math.max(5, state.settings.rotationIntervalSec) * 1000;
    const timer = window.setInterval(() => setTick((value) => value + 1), interval);
    return () => window.clearInterval(timer);
  }, [state?.id, state?.settings.autoRotation, state?.settings.overlayMode, state?.settings.rotationIntervalSec]);

  const view = useMemo<OverlayView>(() => {
    if (!state) return 'next_matches';
    if (state.presentation.active) return 'presentation';
    if (state.settings.overlayMode !== 'result_screen' && resultIsActive) return 'result_screen';
    const mode = state.settings.overlayMode;
    if (mode && mode !== 'auto') return mode === 'presentation' && !state.presentation.active ? 'current_match' : mode;
    if (!state.settings.autoRotation) return 'current_match';
    // auto rotation
    const inKnockout = state.state === 'SEMIFINALS' || state.state === 'FINAL' || state.state === 'FINISHED';
    if (inKnockout) {
      const seq: OverlayView[] = ['bracket', 'current_match'];
      return seq[tick % seq.length];
    }
    const seq: OverlayView[] = ['next_matches', 'table'];
    return seq[tick % seq.length];
  }, [state, tick, resultIsActive]);

  if (!state) return null;

  const theme = state.settings.theme;
  const dark = theme === 'dark';
  const text = dark ? 'text-slate-100' : 'text-slate-900';
  const panel = dark ? 'bg-slate-900/85 border-slate-700' : 'bg-white/85 border-slate-300';
  const accent = dark ? 'text-emerald-400' : 'text-emerald-600';
  const muted = dark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`overlay-root h-screen overflow-hidden ${text}`} style={{ background: state.settings.transparent ? 'transparent' : dark ? '#0f172a' : '#f8fafc' }}>
      <div className={state.settings.compact ? 'mx-auto flex h-full max-w-3xl flex-col justify-center overflow-hidden p-2' : 'mx-auto flex h-full max-w-5xl flex-col justify-center overflow-hidden p-4'}>
        {/* header */}
        {(state.settings.showTournamentName || state.settings.showLogo) && (
          <div className="mb-2 flex items-center gap-2">
            {state.settings.showLogo && (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-sm font-black text-slate-950">G</div>
            )}
            {state.settings.showTournamentName && (
              <div className={`text-lg font-black tracking-tight ${text}`}>{state.name}</div>
            )}
            <div className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{STAGE_LABELS[state.state] ?? state.state}</div>
          </div>
        )}

        {view === 'next_matches' && <NextMatches state={state} panel={panel} accent={accent} muted={muted} />}
        {view === 'table' && <Tables state={state} panel={panel} accent={accent} />}
        {view === 'bracket' && (
          <div className={`rounded-xl border ${panel} p-4`}>
            <Bracket state={state} compact={state.settings.compact} />
          </div>
        )}
        {view === 'current_match' && <CurrentMatch state={state} panel={panel} accent={accent} muted={muted} />}
        {view === 'result_screen' && <ResultView state={state} />}
        {view === 'presentation' && <PresentationView state={state} />}
      </div>
    </div>
  );
}

function ResultView({ state }: { state: TournamentStateDTO }) {
  const match = state.matches.find((entry) => entry.id === state.resultScreen?.matchId)
    ?? [...state.matches].reverse().find((entry) => entry.status === 'finished' && entry.result);
  return match
    ? <MatchSpotlight state={state} match={match} />
    : <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-8 text-center text-slate-300">Noch kein Spielergebnis vorhanden.</div>;
}

function PresentationView({ state }: { state: TournamentStateDTO }) {
  const deck = state.presentation.decks.find((item) => item.id === state.presentation.activeDeckId) ?? state.presentation.decks[0];
  const slide = deck?.slides[state.presentation.currentIndex];
  return slide ? <section className="mx-auto flex max-h-full min-h-0 w-full max-w-6xl flex-col items-center justify-center overflow-hidden rounded-3xl border border-emerald-400/30 bg-slate-950/95 p-6 text-center text-slate-100 shadow-2xl sm:p-10">
    <div className="text-xs font-bold uppercase tracking-[0.35em] text-emerald-300 sm:text-sm">{deck?.title} · {state.presentation.currentIndex + 1}/{deck.slides.length}</div>
    <h1 className="mt-5 text-4xl font-black leading-tight sm:mt-8 sm:text-5xl xl:text-7xl">{slide.title}</h1>
    <p className="mt-5 max-w-4xl whitespace-pre-wrap text-lg leading-relaxed text-slate-200 sm:mt-8 sm:text-2xl xl:text-4xl">{slide.text}</p>
    {slide.imageUrl && <img src={slide.imageUrl} alt="" className="mt-5 max-h-[30vh] max-w-full rounded-2xl object-contain sm:mt-8" />}
  </section> : <div className="rounded-xl border border-slate-700 bg-slate-900 p-8 text-center text-slate-300">Die Präsentation enthält keine Folien.</div>;
}

function Identity({ state, unitId }: { state: TournamentStateDTO; unitId: string | null }) {
  const unit = state.units.find((entry) => entry.id === unitId);
  if (!unit) return <span>—</span>;
  return <span className="inline-flex min-w-0 items-center gap-1.5"><span className="flex shrink-0 -space-x-2">{unit.members.map((member) => member.imageUrl ? <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-8 w-8 rounded-full border-2 border-slate-900 object-cover" /> : <span key={member.id} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-700 text-xs font-bold">{member.name.slice(0, 1).toUpperCase()}</span>)}</span><span className="truncate">{unit.name}{unit.kind === 'team' && <span className="ml-1 text-xs font-normal text-slate-400">· {unit.members.map((member) => member.name).join(' & ')}</span>}</span></span>;
}

function NextMatches({
  state,
  panel,
  accent,
  muted,
}: {
  state: TournamentStateDTO;
  panel: string;
  accent: string;
  muted: string;
}) {
  const upcoming = state.matches.filter((m) => m.status === 'waiting' && m.aUnitId && m.bUnitId).slice(0, state.settings.compact ? 3 : 5);
  return (
    <div className={`max-h-full overflow-hidden rounded-xl border ${panel} p-4`}>
      <div className={`mb-2 text-sm font-bold uppercase tracking-wider ${accent}`}>Nächste Spiele</div>
      {upcoming.length === 0 && <div className={`text-sm ${muted}`}>Keine nächsten Spiele</div>}
      <div className="space-y-1.5">
        {upcoming.map((m) => (
          <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-base font-bold sm:gap-4 sm:text-lg">
            <span className="flex items-center gap-1.5">
              {state.settings.showFlags && flagEmoji(state.units.find((u) => u.id === m.aUnitId)?.country ?? null)}
              <Identity state={state} unitId={m.aUnitId} />
            </span>
            <span className="text-xs font-black uppercase text-slate-500">gegen</span>
            <span className="flex items-center gap-1.5">
              {state.settings.showFlags && flagEmoji(state.units.find((u) => u.id === m.bUnitId)?.country ?? null)}
              <Identity state={state} unitId={m.bUnitId} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tables({ state, panel, accent }: { state: TournamentStateDTO; panel: string; accent: string }) {
  const groups = state.groups;
  return (
    <div className={`max-h-full overflow-hidden rounded-xl border ${panel} p-3 sm:p-4`}>
      <div className={`mb-2 text-sm font-bold uppercase tracking-wider ${accent}`}>
        {groups.length ? 'Gruppentabelle' : 'Tabellenstellung'}
      </div>
      {groups.length >= 2 ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-6">
          {groups.map((g) => (
            <StandingsTable key={g.id} title={g.name} rows={state.groupStandings[g.id] ?? []} showFlags={state.settings.showFlags} compact={state.settings.compact} state={state} />
          ))}
        </div>
      ) : (
        <StandingsTable rows={state.standings} showFlags={state.settings.showFlags} compact={state.settings.compact} state={state} />
      )}
    </div>
  );
}

function CurrentMatch({
  state,
  panel,
  accent,
  muted,
}: {
  state: TournamentStateDTO;
  panel: string;
  accent: string;
  muted: string;
}) {
  const current = state.matches.find((m) => m.id === state.currentMatchId);
  if (!current) {
    return (
      <div className={`rounded-xl border ${panel} p-4`}>
        <div className={`text-sm ${muted}`}>Kein Spiel ausgewählt</div>
      </div>
    );
  }
  return (
    <div className={`rounded-xl border ${panel} p-3 sm:p-4`}>
      <div className={`mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${accent}`}>
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
        {current.label}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-center gap-2 py-2 text-center sm:gap-6">
        <div className="min-w-0 truncate text-xl font-black sm:text-3xl">
          {state.settings.showFlags && flagEmoji(state.units.find((u) => u.id === current.aUnitId)?.country ?? null)}{' '}
          <Identity state={state} unitId={current.aUnitId} />
        </div>
        <div className="text-lg font-black uppercase text-slate-500">gegen</div>
        <div className="min-w-0 truncate text-xl font-black sm:text-3xl">
          {state.settings.showFlags && flagEmoji(state.units.find((u) => u.id === current.bUnitId)?.country ?? null)}{' '}
          <Identity state={state} unitId={current.bUnitId} />
        </div>
      </div>
    </div>
  );
}
