// Match list grouped by stage with moderator "set current" support.

import type { MatchDTO, TournamentStateDTO } from '@gt/shared';
import { unitName } from '../lib/api';

interface Props {
  state: TournamentStateDTO;
  onSelectCurrent?: (matchId: string) => void;
  onEdit?: (matchId: string) => void;
  selectedMatchId?: string | null;
  editingMatchId?: string | null;
}

const STAGE_LABEL: Record<string, string> = {
  PRELIMINARY: 'Vorrunde',
  SEMIFINALS: 'Halbfinale',
  FINAL: 'Finale',
};

const STATUS_STYLE: Record<string, string> = {
  waiting: 'bg-slate-800 text-slate-400',
  live: 'bg-red-600 text-white animate-pulse',
  finished: 'bg-emerald-600/80 text-white',
};

export default function MatchList({ state, onSelectCurrent, onEdit, selectedMatchId, editingMatchId }: Props) {
  const stages = ['PRELIMINARY', 'SEMIFINALS', 'FINAL'] as const;
  return (
    <div className="space-y-6">
      {stages.map((stage) => {
        const matches = state.matches.filter((m) => m.stage === stage);
        if (matches.length === 0) return null;
        return (
          <div key={stage}>
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">{STAGE_LABEL[stage]}</div>
            <div className="space-y-1.5">
              {matches.map((m: MatchDTO) => (
                <div
                  key={m.id}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    m.id === selectedMatchId ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900/60'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-xs font-bold text-slate-500">{m.label}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[m.status]}`}>
                        {m.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 truncate text-sm font-semibold">
                      {m.aUnitId && state.units.find((unit) => unit.id === m.aUnitId)?.members.map((member) => member.imageUrl && <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-6 w-6 rounded-full object-cover" />)}
                      {unitName(state, m.aUnitId)} gegen
                      {m.bUnitId && state.units.find((unit) => unit.id === m.bUnitId)?.members.map((member) => member.imageUrl && <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-6 w-6 rounded-full object-cover" />)}
                      {unitName(state, m.bUnitId)}
                    </div>
                    {m.result && (
                      <div className="text-xs text-slate-400 table-cell-num">
                        {m.result.aDamageDealt} – {m.result.bDamageDealt} Schaden · Sieger{' '}
                        <span className="font-semibold text-emerald-400">{unitName(state, m.result.winnerUnitId)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {onEdit && m.aUnitId && m.bUnitId && (
                      <button
                        onClick={() => onEdit(m.id)}
                        className={`btn-ghost px-2 py-1 text-xs ${m.id === editingMatchId ? 'bg-emerald-500/20 text-emerald-300' : ''}`}
                      >
                        {m.status === 'finished' ? 'ERGEBNIS BEARBEITEN' : 'Ergebnis eingeben'}
                      </button>
                    )}
                    {onSelectCurrent && m.status !== 'finished' && m.aUnitId && m.bUnitId && (
                      <button
                        onClick={() => onSelectCurrent(m.id)}
                        className="btn-primary px-2 py-1 text-xs"
                        title="Dieses kommende Spiel sofort aktivieren"
                      >
                        JETZT SPIELEN
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
