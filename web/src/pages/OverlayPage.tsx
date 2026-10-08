// OBS overlay: transparent, configurable rotating stream views.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { TournamentStateDTO, OverlayView, OverlayOverrideDTO } from '@gt/shared';
import { selectOverlayRotationView } from '@gt/shared';
import { unitName, useTournamentState } from '../lib/api';
import StandingsTable, { flagEmoji } from '../components/StandingsTable';
import Bracket from '../components/Bracket';
import MatchSpotlight, { useResultScreenActive } from '../components/MatchSpotlight';
import FullscreenVideo from '../components/FullscreenVideo';

const STAGE_LABELS: Record<string, string> = { PRELIMINARY: 'Vorrunde', SEMIFINALS: 'Halbfinale', FINAL: 'Finale' };

export default function OverlayPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useTournamentState(id ?? null);
  const [tick, setTick] = useState(0);
  const resultIsActive = useResultScreenActive(state?.resultScreen?.until, state?.resultScreen?.matchId);

  useEffect(() => {
    if (!state || !state.settings.autoRotation || state.settings.overlayMode !== 'auto' || state.settings.rotationViews.length <= 1) return;
    const interval = Math.max(5, state.settings.rotationIntervalSec) * 1000;
    const timer = window.setInterval(() => setTick((value) => value + 1), interval);
    return () => window.clearInterval(timer);
  }, [state?.id, state?.settings.autoRotation, state?.settings.overlayMode, state?.settings.rotationIntervalSec, state?.settings.rotationViews]);

  const view = useMemo<OverlayView | 'result_screen'>(() => {
    if (!state) return 'next_matches';
    if (state.presentationVideo?.active || state.presentation.active) return 'presentation';
    if (state.settings.overlayMode !== 'result_screen' && resultIsActive) return 'result_screen';
    const mode = state.settings.overlayMode;
    if (mode && mode !== 'auto') return mode === 'presentation' && !state.presentation.active ? 'current_match' : mode as Exclude<OverlayOverrideDTO['mode'], 'auto'>;
    if (!state.settings.autoRotation) return 'current_match';
    return selectOverlayRotationView(state.settings.rotationViews, tick);
  }, [state, tick, resultIsActive]);

  if (!state) return null;
  const text = 'text-slate-100';
  const panel = 'bg-slate-900/90 border-slate-700';
  const accent = 'text-emerald-300';
  const muted = 'text-slate-400';
  if (state.presentationVideo?.active) return <FullscreenVideo video={state.presentationVideo} />;

  return <div className={`overlay-root h-screen overflow-hidden ${text}`} style={{ background: state.settings.transparent ? 'transparent' : '#020617' }}>
    <div className={`overlay-frame mx-auto flex h-full w-full flex-col overflow-hidden ${state.settings.compact ? 'p-2 sm:p-4' : 'p-3 sm:p-6'}`}>
      {(state.settings.showTournamentName || state.settings.showLogo) && <div className="mb-2 flex flex-none items-center gap-2">
        {state.settings.showLogo && <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-sm font-black text-slate-950">G</div>}
        {state.settings.showTournamentName && <div className={`text-lg font-black tracking-tight ${text}`}>{state.name}</div>}
        <div className={`text-xs font-bold uppercase tracking-wider ${muted}`}>{STAGE_LABELS[state.state] ?? state.state}</div>
      </div>}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {view === 'next_matches' && <NextMatches state={state} panel={panel} accent={accent} muted={muted} />}
        {view === 'all_matches' && <AllMatches state={state} panel={panel} accent={accent} />}
        {view === 'table' && <Tables state={state} panel={panel} accent={accent} />}
        {view === 'bracket' && <div className={`overlay-panel max-h-full w-full overflow-hidden rounded-xl border ${panel} p-3 sm:p-5`}><Bracket state={state} compact /></div>}
        {view === 'current_match' && <CurrentMatch state={state} panel={panel} accent={accent} muted={muted} />}
        {view === 'result_screen' && <ResultView state={state} />}
        {view === 'presentation' && <PresentationView state={state} />}
      </div>
    </div>
  </div>;
}

function ResultView({ state }: { state: TournamentStateDTO }) {
  const match = state.matches.find((entry) => entry.id === state.resultScreen?.matchId) ?? [...state.matches].reverse().find((entry) => entry.status === 'finished' && entry.result);
  return match ? <MatchSpotlight state={state} match={match} overlay /> : <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-8 text-center text-slate-300">Noch kein Spielergebnis vorhanden.</div>;
}

function PresentationView({ state }: { state: TournamentStateDTO }) {
  const deck = state.presentation.decks.find((item) => item.id === state.presentation.activeDeckId) ?? state.presentation.decks[0];
  const slide = deck?.slides[state.presentation.currentIndex];
  return slide ? <section className="overlay-panel mx-auto flex max-h-full min-h-0 w-full max-w-6xl flex-col items-center justify-center overflow-hidden rounded-3xl border border-emerald-400/30 bg-slate-950/95 p-3 text-center text-slate-100 shadow-2xl sm:p-6"><div className="truncate text-xs font-bold uppercase tracking-[0.25em] text-emerald-300 sm:text-sm">{deck?.title} · {state.presentation.currentIndex + 1}/{deck.slides.length}</div><h1 className="mt-3 line-clamp-2 text-2xl font-black leading-tight sm:mt-5 sm:text-4xl xl:text-6xl">{slide.title}</h1><p className="mt-3 line-clamp-5 max-w-4xl overflow-hidden whitespace-pre-wrap text-sm leading-relaxed text-slate-200 sm:mt-5 sm:text-lg xl:text-2xl">{slide.text}</p>{slide.imageUrl && <img src={slide.imageUrl} alt="" className="mt-3 max-h-[28%] max-w-full rounded-2xl object-contain sm:mt-5" />}</section> : <div className="rounded-xl border border-slate-700 bg-slate-900 p-8 text-center text-slate-300">Die Präsentation enthält keine Folien.</div>;
}

function Identity({ state, unitId }: { state: TournamentStateDTO; unitId: string | null }) {
  const unit = state.units.find((entry) => entry.id === unitId);
  if (!unit) return <span>—</span>;
  return <span className="inline-flex min-w-0 items-center gap-1.5"><span className="flex shrink-0 -space-x-2">{unit.members.map((member) => member.imageUrl ? <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-7 w-7 rounded-full border-2 border-slate-900 object-cover" /> : <span key={member.id} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-700 text-xs font-bold">{member.name.slice(0, 1).toUpperCase()}</span>)}</span><span className="truncate">{unit.name}{unit.kind === 'team' && <span className="ml-1 text-xs font-normal text-slate-400">· {unit.members.map((member) => member.name).join(' & ')}</span>}</span></span>;
}

function NextMatches({ state, panel, accent, muted }: { state: TournamentStateDTO; panel: string; accent: string; muted: string }) {
  const upcoming = state.matches.filter((match) => match.status !== 'finished' && match.aUnitId && match.bUnitId).slice(0, state.settings.compact ? 3 : 4);
  return <div className={`overlay-panel max-h-full w-full overflow-hidden rounded-xl border ${panel} p-3 sm:p-5`}><div className={`mb-2 text-sm font-bold uppercase tracking-wider ${accent}`}>Nächste Spiele</div>{upcoming.length === 0 && <div className={`text-sm ${muted}`}>Keine nächsten Spiele</div>}<div className="space-y-1.5">{upcoming.map((match) => <div key={match.id} className="overlay-row grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t border-slate-700/60 py-1.5 text-sm font-bold sm:gap-4 sm:py-2 sm:text-lg"><span className="flex items-center gap-1.5">{state.settings.showFlags && flagEmoji(state.units.find((unit) => unit.id === match.aUnitId)?.country ?? null)}<Identity state={state} unitId={match.aUnitId} /></span><span className="text-xs font-black uppercase text-slate-500">gegen</span><span className="flex items-center gap-1.5">{state.settings.showFlags && flagEmoji(state.units.find((unit) => unit.id === match.bUnitId)?.country ?? null)}<Identity state={state} unitId={match.bUnitId} /></span></div>)}</div></div>;
}

function AllMatches({ state, panel, accent }: { state: TournamentStateDTO; panel: string; accent: string }) {
  const matches = state.matches.filter((match) => match.aUnitId && match.bUnitId);
  return <section className={`overlay-panel max-h-full w-full overflow-hidden rounded-xl border ${panel} p-3 text-slate-100 sm:p-5`}>
    <h2 className={`mb-2 text-sm font-black uppercase tracking-wider ${accent}`}>Alle Spiele · {matches.filter((match) => match.status === 'finished').length}/{matches.length} beendet</h2>
    <div className="max-h-full space-y-1 overflow-auto pr-1">{matches.map((match) => {
      const winner = match.result?.winnerUnitId;
      const aStyle = !winner ? 'bg-slate-800/70 text-slate-200' : winner === match.aUnitId ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200';
      const bStyle = !winner ? 'bg-slate-800/70 text-slate-200' : winner === match.bUnitId ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200';
      return <div key={match.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-950/70 p-2 sm:gap-3"><div className="text-[9px] font-bold uppercase text-slate-500 sm:text-xs">{match.label}</div><div className={`min-w-0 rounded px-2 py-1 text-xs font-bold sm:text-sm ${aStyle}`}><Identity state={state} unitId={match.aUnitId} /></div><div className="text-[9px] font-black uppercase text-slate-500">{match.status === 'live' ? 'LIVE' : match.status === 'finished' ? `${match.result?.aDamageDealt}–${match.result?.bDamageDealt}` : 'VS'}</div><div className={`min-w-0 rounded px-2 py-1 text-xs font-bold sm:text-sm ${bStyle}`}><Identity state={state} unitId={match.bUnitId} /></div></div>;
    })}</div>
  </section>;
}

function Tables({ state, panel, accent }: { state: TournamentStateDTO; panel: string; accent: string }) {
  const groups = state.groups;
  return <div className={`overlay-panel max-h-full w-full overflow-hidden rounded-xl border ${panel} p-3 sm:p-5`}><div className={`mb-2 text-sm font-bold uppercase tracking-wider ${accent}`}>{groups.length ? 'Gruppentabelle' : 'Tabellenstellung'}</div>{groups.length >= 2 ? <div className="grid grid-cols-2 gap-3 sm:gap-6">{groups.map((group) => <StandingsTable key={group.id} title={group.name} rows={state.groupStandings[group.id] ?? []} showFlags={state.settings.showFlags} compact={state.settings.compact} state={state} />)}</div> : <StandingsTable rows={state.standings} showFlags={state.settings.showFlags} compact={state.settings.compact} state={state} />}</div>;
}

function CurrentMatch({ state, panel, accent, muted }: { state: TournamentStateDTO; panel: string; accent: string; muted: string }) {
  const current = state.matches.find((match) => match.id === state.currentMatchId);
  if (!current) return <div className={`overlay-panel rounded-xl border ${panel} p-3 sm:p-5`}><div className={`text-sm ${muted}`}>Kein Spiel ausgewählt</div></div>;
  return <div className={`overlay-panel w-full rounded-xl border ${panel} p-3 sm:p-5`}><div className={`mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${accent}`}><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />{current.label}</div><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-center gap-2 py-2 text-center sm:gap-6"><div className="min-w-0 truncate text-base font-black sm:text-2xl xl:text-3xl">{state.settings.showFlags && flagEmoji(state.units.find((unit) => unit.id === current.aUnitId)?.country ?? null)} <Identity state={state} unitId={current.aUnitId} /></div><div className="text-xs font-black uppercase text-slate-500 sm:text-base">gegen</div><div className="min-w-0 truncate text-base font-black sm:text-2xl xl:text-3xl">{state.settings.showFlags && flagEmoji(state.units.find((unit) => unit.id === current.bUnitId)?.country ?? null)} <Identity state={state} unitId={current.bUnitId} /></div></div></div>;
}
