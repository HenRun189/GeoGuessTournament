// Knockout bracket: SF1/SF2 feeding the final. Shows champion when finished.

import type { TournamentStateDTO } from '@gt/shared';
import { unitName } from '../lib/api';

function Slot({ state, unitId, winner, loser }: { state: TournamentStateDTO; unitId: string | null; winner: boolean; loser: boolean }) {
  const unit = state.units.find((entry) => entry.id === unitId);
  return <div className={`flex min-w-0 items-center justify-between rounded border px-2 py-1 text-sm font-semibold ${winner ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : loser ? 'border-slate-800 bg-slate-900/40 text-slate-500 line-through' : 'border-slate-700 bg-slate-900'}`}>
    <span className="flex min-w-0 items-center gap-1.5 truncate">{unit?.members.map((member) => member.imageUrl
      ? <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-6 w-6 shrink-0 rounded-full object-cover" />
      : <span key={member.id} aria-label={`Kein Profilbild für ${member.name}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold">{member.name.slice(0, 1).toUpperCase()}</span>)}<span className="truncate">{unit?.name ?? '—'}</span></span>
  </div>;
}

export default function Bracket({ state, compact = false }: { state: TournamentStateDTO; compact?: boolean }) {
  const ko = state.knockout;
  if (!ko || (!ko.sf1 && !ko.sf2 && !ko.final)) return <div className="text-sm text-slate-500">Turnierbaum noch nicht erzeugt — Vorrunde abschließen.</div>;

  const sf1Winner = ko.sf1?.result?.winnerUnitId ?? null;
  const sf2Winner = ko.sf2?.result?.winnerUnitId ?? null;
  const champion = ko.championUnitId;
  const groupMatches = state.matches.filter((match) => match.stage === 'PRELIMINARY' && match.aUnitId && match.bUnitId);

  return <div className={compact ? 'space-y-2' : 'space-y-6'}>
    {state.groups.length > 0 && !compact && <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Gruppenphase · Spielplan</div>
      <div className="grid gap-3 sm:grid-cols-2">{state.groups.map((group) => <div key={group.id} className="space-y-1.5">
        <div className="text-xs font-semibold text-emerald-300">{group.name}</div>
        {groupMatches.filter((match) => group.unitIds.includes(match.aUnitId!) && group.unitIds.includes(match.bUnitId!)).map((match) => <div key={match.id} className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-xs ${match.status === 'live' ? 'bg-red-500/15 text-red-200' : match.status === 'finished' ? 'bg-slate-800/50 text-slate-400' : 'bg-slate-900 text-slate-300'}`}><span className="truncate">{unitName(state, match.aUnitId)} vs {unitName(state, match.bUnitId)}</span><span className="shrink-0">{match.label}</span></div>)}
      </div>)}</div>
    </section>}
    {state.state === 'PRELIMINARY' && state.groups.length === 0 && !compact && <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-400">Vorrunde · {state.matches.filter((match) => match.stage === 'PRELIMINARY').length} Spiele in der gespeicherten Engine-Reihenfolge</div>}

    <div className={`relative grid gap-3 sm:gap-6 ${compact ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-[1fr_1fr]'}`}>
      <div className={compact ? 'relative space-y-1' : 'relative space-y-4'}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">Halbfinale</div>
        <div className={compact ? 'space-y-2 py-1' : 'space-y-8 py-2'}>
          {[ko.sf1, ko.sf2].map((match, index) => {
            const winnerId = index === 0 ? sf1Winner : sf2Winner;
            return <div key={match?.id ?? `sf${index + 1}`} className="relative space-y-1 rounded-lg border border-slate-800 bg-slate-950/30 p-1.5 sm:p-2">
              <Slot state={state} unitId={match?.aUnitId ?? null} winner={winnerId === match?.aUnitId} loser={!!winnerId && winnerId !== match?.aUnitId} />
              <Slot state={state} unitId={match?.bUnitId ?? null} winner={winnerId === match?.bUnitId} loser={!!winnerId && winnerId !== match?.bUnitId} />
              {!compact && <div className="absolute -right-4 top-1/2 h-px w-4 bg-emerald-500/50" />}
            </div>;
          })}
        </div>
      </div>

      <div className={compact ? 'relative space-y-1' : 'relative space-y-4'}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">Finale</div>
        <div className={`relative ${compact ? 'mt-1' : 'mt-16'} space-y-1 rounded-lg border border-slate-800 bg-slate-950/30 p-1.5 sm:p-2`}>
          {!compact && <><div className="absolute -left-4 top-1/4 h-px w-4 bg-emerald-500/50" /><div className="absolute -left-4 top-3/4 h-px w-4 bg-emerald-500/50" /><div className="absolute -left-4 left-0 top-1/4 h-1/2 w-px bg-emerald-500/50" /></>}
          <Slot state={state} unitId={ko.final?.aUnitId ?? null} winner={champion === ko.final?.aUnitId} loser={!!champion && champion !== ko.final?.aUnitId} />
          <Slot state={state} unitId={ko.final?.bUnitId ?? null} winner={champion === ko.final?.bUnitId} loser={!!champion && champion !== ko.final?.bUnitId} />
          {champion && <div className="mt-2 rounded-lg border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-center">
            <div className="text-[9px] font-bold uppercase tracking-widest text-amber-400 sm:text-[10px]">Turniersieger</div>
            <div className="truncate text-xs font-black text-amber-300 sm:text-base">{unitName(state, champion)}</div>
            {!compact && <div className="text-xs text-amber-100/70">{state.units.find((unit) => unit.id === champion)?.members.map((member) => member.name).join(' & ')}</div>}
          </div>}
        </div>
      </div>
    </div>
    {ko.eliminatedUnitIds.length > 0 && !compact && <div className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Ausgeschieden</div>
      <div className="flex flex-wrap gap-1.5">{ko.eliminatedUnitIds.map((uid) => <span key={uid} className="rounded bg-slate-800/80 px-2 py-0.5 text-xs font-semibold text-slate-400 line-through">{unitName(state, uid)}</span>)}</div>
    </div>}
  </div>;
}
