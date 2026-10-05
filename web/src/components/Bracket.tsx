// Knockout bracket: SF1/SF2 feeding the final. Shows champion when finished.

import type { TournamentStateDTO } from '@gt/shared';
import { unitName } from '../lib/api';

function Slot({ name, winner, loser }: { name: string; winner: boolean; loser: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded border px-2 py-1 text-sm font-semibold ${
        winner
          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
          : loser
            ? 'border-slate-800 bg-slate-900/40 text-slate-500 line-through'
            : 'border-slate-700 bg-slate-900'
      }`}
    >
      <span className="truncate">{name}</span>
    </div>
  );
}

export default function Bracket({ state, compact = false }: { state: TournamentStateDTO; compact?: boolean }) {
  const ko = state.knockout;
  if (!ko || (!ko.sf1 && !ko.sf2 && !ko.final)) {
    return <div className="text-sm text-slate-500">Turnierbaum noch nicht erzeugt — Vorrunde abschließen.</div>;
  }

  const sf1Winner = ko.sf1?.result?.winnerUnitId ?? null;
  const sf2Winner = ko.sf2?.result?.winnerUnitId ?? null;
  const champion = ko.championUnitId;

  const groupMatches = state.matches.filter((match) => match.stage === 'PRELIMINARY' && match.aUnitId && match.bUnitId);

  return (
    <div className="space-y-6">
      {state.groups.length > 0 && <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Gruppenphase · Spielplan</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {state.groups.map((group) => <div key={group.id} className="space-y-1.5">
            <div className="text-xs font-semibold text-emerald-300">{group.name}</div>
            {groupMatches.filter((match) => group.unitIds.includes(match.aUnitId!) && group.unitIds.includes(match.bUnitId!)).map((match) => <div key={match.id} className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-xs ${match.status === 'live' ? 'bg-red-500/15 text-red-200' : match.status === 'finished' ? 'bg-slate-800/50 text-slate-400' : 'bg-slate-900 text-slate-300'}`}>
              <span className="truncate">{unitName(state, match.aUnitId)} vs {unitName(state, match.bUnitId)}</span><span className="shrink-0">{match.label}</span>
            </div>)}
          </div>)}
        </div>
      </section>}
      {state.state === 'PRELIMINARY' && state.groups.length === 0 && <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">Vorrunde · {state.matches.filter((match) => match.stage === 'PRELIMINARY').length} Spiele in der gespeicherten Engine-Reihenfolge</div>}

      <div className={`relative grid gap-6 ${compact ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-[1fr_1fr]'}`}>
        <div className="relative space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Halbfinale</div>
        <div className="space-y-8 py-2">
          <div className="relative space-y-1 rounded-lg border border-slate-800 bg-slate-950/30 p-2">
            <Slot name={unitName(state, ko.sf1?.aUnitId ?? null)} winner={sf1Winner === ko.sf1?.aUnitId} loser={!!sf1Winner && sf1Winner !== ko.sf1?.aUnitId} />
            <Slot name={unitName(state, ko.sf1?.bUnitId ?? null)} winner={sf1Winner === ko.sf1?.bUnitId} loser={!!sf1Winner && sf1Winner !== ko.sf1?.bUnitId} />
            <div className="absolute -right-4 top-1/2 h-px w-4 bg-emerald-500/50" />
          </div>
          <div className="relative space-y-1 rounded-lg border border-slate-800 bg-slate-950/30 p-2">
            <Slot name={unitName(state, ko.sf2?.aUnitId ?? null)} winner={sf2Winner === ko.sf2?.aUnitId} loser={!!sf2Winner && sf2Winner !== ko.sf2?.aUnitId} />
            <Slot name={unitName(state, ko.sf2?.bUnitId ?? null)} winner={sf2Winner === ko.sf2?.bUnitId} loser={!!sf2Winner && sf2Winner !== ko.sf2?.bUnitId} />
            <div className="absolute -right-4 top-1/2 h-px w-4 bg-emerald-500/50" />
          </div>
        </div>
      </div>

        <div className="relative space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Finale</div>
          <div className="relative mt-16 space-y-1 rounded-lg border border-slate-800 bg-slate-950/30 p-2">
            <div className="absolute -left-4 top-1/4 h-px w-4 bg-emerald-500/50" />
            <div className="absolute -left-4 top-3/4 h-px w-4 bg-emerald-500/50" />
            <div className="absolute -left-4 left-0 top-1/4 h-1/2 w-px bg-emerald-500/50" />
            <div className="space-y-1">
              <Slot name={unitName(state, ko.final?.aUnitId ?? null)} winner={champion === ko.final?.aUnitId} loser={!!champion && champion !== ko.final?.aUnitId} />
              <Slot name={unitName(state, ko.final?.bUnitId ?? null)} winner={champion === ko.final?.bUnitId} loser={!!champion && champion !== ko.final?.bUnitId} />
            </div>
            {champion && (
              <div className="mt-3 rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Sieger</div>
                <div className="text-lg font-black text-amber-300">{unitName(state, champion)}</div>
              </div>
            )}
          </div>
        </div>
      </div>
      {ko.eliminatedUnitIds.length > 0 && <div className="space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Ausgeschieden</div>
        <div className="flex flex-wrap gap-1.5">
          {ko.eliminatedUnitIds.length === 0 && <span className="text-sm text-slate-500">—</span>}
          {ko.eliminatedUnitIds.map((uid) => (
            <span key={uid} className="rounded bg-slate-800/80 px-2 py-0.5 text-xs font-semibold text-slate-400 line-through">
              {unitName(state, uid)}
            </span>
          ))}
        </div>
      </div>}
    </div>
  );
}
