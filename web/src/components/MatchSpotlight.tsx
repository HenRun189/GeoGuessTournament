import { useEffect, useState } from 'react';
import type { MatchDTO, TournamentStateDTO } from '@gt/shared';
import { unitName } from '../lib/api';

export function useResultScreenActive(until: string | null | undefined, matchId?: string | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(until) - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [until, matchId]);
  return Boolean(until && Date.parse(until) > now);
}

export default function MatchSpotlight({ state, match, overlay = false }: { state: TournamentStateDTO; match: MatchDTO; overlay?: boolean }) {
  const result = match.result;
  if (!result || !match.aUnitId || !match.bUnitId) return null;
  const winnerId = result.winnerUnitId;
  const winner = state.units.find((unit) => unit.id === winnerId);
  const tournamentChampion = match.stage === 'FINAL' && state.knockout?.championUnitId === winnerId;
  const side = (unitId: string, damage: number, won: boolean) => {
    const unit = state.units.find((entry) => entry.id === unitId);
    return <div className={`spotlight-side flex min-w-0 flex-1 flex-col items-center rounded-2xl border p-3 sm:p-5 ${won ? 'border-emerald-500/50 bg-emerald-500/[0.08] shadow-xl shadow-emerald-950/20' : 'border-rose-500/35 bg-rose-500/[0.06]'}`}>
      <div className={`mb-2 flex -space-x-3 ${won ? 'winner-avatar' : ''}`}>{unit?.members.map((member) => member.imageUrl
        ? <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-14 w-14 rounded-full border-2 border-slate-900 object-cover sm:h-20 sm:w-20" />
        : <span key={member.id} title={member.name} className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-800 text-xl font-black text-emerald-300 sm:h-20 sm:w-20">{member.name.slice(0, 1).toUpperCase()}</span>)}</div>
      <div className="w-full truncate text-center text-lg font-black sm:text-2xl">{unit?.name ?? '—'}</div>
      {unit?.members && <div className="mt-1 line-clamp-2 text-center text-xs text-slate-400 sm:text-sm">{unit.members.map((member) => member.name).join(' & ')}</div>}
      <div className="mt-2 font-mono text-xl font-black tabular-nums sm:text-3xl">{damage}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Schaden ausgeteilt</div>
      <div className="mt-1 text-[10px] font-semibold text-slate-500 sm:text-xs">Eingesteckt: {unitId === match.aUnitId ? result.bDamageDealt : result.aDamageDealt}</div>
      <div className={`mt-3 text-sm font-black uppercase tracking-wider sm:text-base ${won ? 'text-emerald-300' : 'text-rose-300'}`}>{won ? 'GEWONNEN' : 'ERGEBNIS'}</div>
    </div>;
  };

  return <section aria-live="polite" className={`spotlight-shell mx-auto w-full max-w-6xl overflow-hidden rounded-3xl border border-amber-400/50 bg-slate-950/95 p-3 text-slate-100 shadow-2xl sm:p-6 ${overlay ? 'max-h-full' : ''} ${tournamentChampion ? 'champion-shell' : ''}`}>
    <header className="spotlight-header mb-3 text-center sm:mb-5">
      <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-300">{state.name}</div>
      <h1 className="mt-1 text-xl font-black uppercase tracking-wide sm:text-3xl">{tournamentChampion ? 'Turniersieg!' : 'Spiel beendet'}</h1>
      <p className="mt-1 text-xs text-slate-400 sm:text-sm">{match.label} · {match.stage === 'PRELIMINARY' ? 'Vorrunde' : match.stage === 'SEMIFINALS' ? 'Halbfinale' : 'Finale'}</p>
    </header>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-5">
      {side(match.aUnitId, result.aDamageDealt, winnerId === match.aUnitId)}
      <div className="px-1 text-xs font-black uppercase tracking-widest text-slate-500 sm:text-lg">GEGEN</div>
      {side(match.bUnitId, result.bDamageDealt, winnerId === match.bUnitId)}
    </div>
    <footer className="spotlight-footer mt-3 text-center sm:mt-5"><div className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-400">{tournamentChampion ? 'Turniersieger' : 'Sieger dieser Partie'}</div><div className="mt-1 text-lg font-black text-emerald-200 sm:text-2xl">{unitName(state, winnerId)}</div>{winner?.members && <div className="mt-1 text-xs text-amber-100/80 sm:text-sm">{winner.members.map((member) => member.name).join(' & ')}</div>}</footer>
  </section>;
}
