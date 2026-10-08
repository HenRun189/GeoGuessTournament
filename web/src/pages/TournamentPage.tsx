// Public live tournament page for spectators.

import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { TournamentStateDTO } from '@gt/shared';
import { unitName, useTournamentState } from '../lib/api';
import StandingsTable from '../components/StandingsTable';
import Bracket from '../components/Bracket';
import MatchSpotlight, { useResultScreenActive } from '../components/MatchSpotlight';
import { flagEmoji } from '../components/StandingsTable';
import FullscreenVideo from '../components/FullscreenVideo';

function Identity({ state, unitId }: { state: TournamentStateDTO; unitId: string | null }) {
  const unit = state.units.find((entry) => entry.id === unitId);
  if (!unit) return <span>—</span>;
  return <span className="inline-flex items-center gap-2"><span className="flex -space-x-2">{unit.members.map((member) => member.imageUrl ? <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-7 w-7 rounded-full border-2 border-slate-900 object-cover" /> : <span key={member.id} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-700 text-xs font-bold">{member.name.slice(0, 1)}</span>)}</span><span>{unit.name}</span></span>;
}

const STATE_LABELS: Record<string, string> = {
  SETUP: 'Einrichten',
  PRELIMINARY: 'Vorrunde',
  SEMIFINALS: 'Halbfinale',
  FINAL: 'Finale',
  FINISHED: 'Beendet',
};

const STATUS_STYLE: Record<string, string> = {
  waiting: 'bg-slate-800 text-slate-400',
  live: 'bg-red-600 text-white',
  finished: 'bg-emerald-600/80 text-white',
};

export default function TournamentPage() {
  const { id } = useParams<{ id: string }>();
  const { state, error, connected } = useTournamentState(id ?? null);
  const resultIsActive = useResultScreenActive(state?.resultScreen?.until, state?.resultScreen?.matchId);
  const bracketRelevant = state?.state === 'SEMIFINALS' || state?.state === 'FINAL' || state?.state === 'FINISHED';
  const [mobileView, setMobileView] = useState<'table' | 'bracket'>('table');
  useEffect(() => {
    if (bracketRelevant) setMobileView('bracket');
  }, [bracketRelevant]);

  if (error && !state) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-red-400">
        {error} <Link to="/" className="underline">Startseite</Link>
      </div>
    );
  }
  if (!state) return <div className="mx-auto max-w-4xl px-4 py-10 text-slate-400">Laden…</div>;

  if (state.presentationVideo?.active) return <FullscreenVideo video={state.presentationVideo} />;

  if (state.presentation.active) {
    const deck = state.presentation.decks.find((item) => item.id === state.presentation.activeDeckId) ?? state.presentation.decks[0];
    const slide = deck?.slides[state.presentation.currentIndex];
    if (slide) return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4"><section className="flex min-h-[80vh] w-full max-w-5xl flex-col items-center justify-center rounded-3xl border border-emerald-400/30 bg-slate-900 p-8 text-center"><div className="text-sm font-bold uppercase tracking-[0.3em] text-emerald-300">{deck.title} · {state.presentation.currentIndex + 1}/{deck.slides.length}</div><h1 className="mt-8 text-4xl font-black sm:text-6xl">{slide.title}</h1><p className="mt-6 max-w-4xl whitespace-pre-wrap text-xl leading-relaxed text-slate-200 sm:text-3xl">{slide.text}</p>{slide.imageUrl && <img src={slide.imageUrl} alt="" className="mt-8 max-h-[35vh] max-w-full rounded-2xl object-contain" />}</section></main>;
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-center text-slate-200">Die Präsentation enthält keine Folien. Bitte den Admin informieren.</main>;
  }
  if (resultIsActive && state.resultScreen) {
    const match = state.matches.find((entry) => entry.id === state.resultScreen?.matchId);
    if (match) return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4"><MatchSpotlight state={state} match={match} /></main>;
  }

  const current = state.matches.find((m) => m.id === state.currentMatchId) ?? null;
  const upcoming = state.matches.filter((m) => m.status === 'waiting' && m.aUnitId && m.bUnitId && m.id !== current?.id).slice(0, 5);
  const orderedUpcoming = [...upcoming].sort((a, b) => (a.stage === 'PRELIMINARY' ? 0 : a.stage === 'SEMIFINALS' ? 1 : 2) - (b.stage === 'PRELIMINARY' ? 0 : b.stage === 'SEMIFINALS' ? 1 : 2) || a.orderInStage - b.orderInStage);
  const finishedMatches = state.matches.filter((m) => m.status === 'finished');
  const champion = state.knockout?.championUnitId;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500 text-xl font-black text-slate-950">G</div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">{state.name}</h1>
            <div className="text-sm text-slate-400">
              {STATE_LABELS[state.state]} · {state.participantCount} Teilnehmer
            </div>
          </div>
          <span className={`ml-2 h-2 w-2 rounded-full ${connected ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'}`} title={connected ? 'Live' : 'Verbindung wiederherstellen…'} />
        </div>
      </div>

      {champion && (
        <div className="card mb-6 border-amber-500/50 bg-amber-500/5 text-center">
          <div className="text-xs font-bold uppercase tracking-widest text-amber-400">Sieger</div>
          <div className="text-3xl font-black text-amber-300">
            {flagEmoji(state.units.find((u) => u.id === champion)?.country ?? null)} <Identity state={state} unitId={champion} />
          </div>
        </div>
      )}

      {current && <div className="card mb-6 border-red-500/40">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase">Live</span>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{current.label} · {current.stage === 'PRELIMINARY' ? 'Vorrunde' : current.stage === 'SEMIFINALS' ? 'Halbfinale' : 'Finale'}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2 text-center">
          <div className="truncate text-xl font-black sm:text-2xl"><Identity state={state} unitId={current.aUnitId} /></div><div className="text-xs font-black text-slate-500">GEGEN</div><div className="truncate text-xl font-black sm:text-2xl"><Identity state={state} unitId={current.bUnitId} /></div>
        </div>
      </div>}

      <div className="mb-6 flex gap-2 md:hidden" role="tablist" aria-label="Turnieransicht">
        <button role="tab" aria-selected={mobileView === 'table'} className={mobileView === 'table' ? 'btn-primary flex-1' : 'btn-secondary flex-1'} onClick={() => setMobileView('table')}>Tabelle</button>
        <button role="tab" aria-selected={mobileView === 'bracket'} className={mobileView === 'bracket' ? 'btn-primary flex-1' : 'btn-secondary flex-1'} onClick={() => setMobileView('bracket')}>Turnierbaum</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
        <div className={`space-y-6 ${mobileView === 'bracket' ? 'hidden md:block' : ''}`}>
          <div className="card">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-400">{state.groups.length ? 'Gruppentabellen' : 'Tabelle / Ranking'}</div>
            {state.groups.length ? <div className="space-y-5">{state.groups.map((group) => <StandingsTable key={group.id} title={group.name} rows={state.groupStandings[group.id] ?? []} showFlags state={state} />)}<div className="border-t border-slate-800 pt-4"><StandingsTable title="Gesamtrangliste" rows={state.standings} showFlags state={state} /></div></div> : <StandingsTable rows={state.standings} showFlags state={state} />}
          </div>
          <div className="card">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-400">Ergebnisse</div>
            {finishedMatches.length === 0 && <div className="text-sm text-slate-500">Noch keine Ergebnisse.</div>}
            <div className="space-y-1.5">{finishedMatches.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-900/60 px-3 py-2 text-sm">
                <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-500">{m.label}</span><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[m.status]}`}>Beendet</span></div>
                <div className="flex items-center gap-3"><span className={`rounded px-1.5 py-1 ${m.result?.winnerUnitId === m.aUnitId ? 'bg-emerald-500/10 font-bold text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}><Identity state={state} unitId={m.aUnitId} /></span><div className="text-right text-xs text-slate-400"><div className="table-cell-num">Ausgeteilt {m.result?.aDamageDealt} – {m.result?.bDamageDealt}</div><div className="table-cell-num text-[10px] text-slate-500">Erhalten {m.result?.aDamageTaken} – {m.result?.bDamageTaken}</div></div><span className={`rounded px-1.5 py-1 ${m.result?.winnerUnitId === m.bUnitId ? 'bg-emerald-500/10 font-bold text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}><Identity state={state} unitId={m.bUnitId} /></span></div>
              </div>
            ))}</div>
          </div>
        </div>
        <div className={`space-y-6 ${mobileView === 'table' ? 'hidden md:block' : ''}`}>
          <div className="card">
            <div className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-400">Turnierbaum</div>
            <Bracket state={state} />
          </div>
          <div className="card">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">Nächste Spiele</div>
            {orderedUpcoming.length === 0 ? <div className="text-sm text-slate-500">Keine weiteren Spiele geplant.</div> : <div className="space-y-1.5 text-sm">{orderedUpcoming.map((m) => <div key={m.id} className="rounded bg-slate-900/60 px-3 py-2"><div className="text-xs font-bold text-slate-500">{m.label}</div><div className="font-semibold"><Identity state={state} unitId={m.aUnitId} /> <span className="text-slate-500">gegen</span> <Identity state={state} unitId={m.bUnitId} /></div></div>)}</div>}
          </div>
        </div>
      </div>

    </div>
  );
}
