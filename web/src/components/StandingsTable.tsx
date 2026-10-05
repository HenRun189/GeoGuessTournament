// Standings table used by admin, public page and overlay.

import type { StandingRowDTO, TournamentStateDTO } from '@gt/shared';

interface Props {
  rows: StandingRowDTO[];
  showPlayed?: boolean;
  compact?: boolean;
  showFlags?: boolean;
  highlightUnitId?: string | null;
  maxRows?: number;
  title?: string;
  state?: TournamentStateDTO;
}

export function flagEmoji(country: string | null): string {
  if (!country) return '';
  const cc = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return country;
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export default function StandingsTable({
  rows,
  showPlayed = true,
  compact = false,
  showFlags = true,
  highlightUnitId,
  maxRows,
  title,
  state,
}: Props) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <div className="w-full">
      {title && <div className="mb-2 text-sm font-bold uppercase tracking-wider text-emerald-400">{title}</div>}
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-slate-400">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Team</th>
            <th className="py-1 px-2 text-center">S</th>
            {showPlayed && <th className="py-1 px-2 text-center">Sp</th>}
            <th className="py-1 px-2 text-center">Schad+</th>
            <th className="py-1 px-2 text-center">Schad-</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr
              key={r.unitId}
              className={`border-t border-slate-800 ${r.unitId === highlightUnitId ? 'bg-emerald-500/10' : ''} ${
                compact ? 'text-sm' : ''
              }`}
            >
              <td className="py-1.5 pr-2 table-cell-num text-slate-400">{r.position}</td>
              <td className="py-1.5 pr-2 font-semibold">
                <span className="flex items-center gap-1.5">
                  {showFlags && r.country && <span>{flagEmoji(r.country)}</span>}
                  {state?.units.find((unit) => unit.id === r.unitId)?.members.map((member) => member.imageUrl
                    ? <img key={member.id} src={member.imageUrl} alt={`Profilbild ${member.name}`} className="h-6 w-6 shrink-0 rounded-full object-cover" />
                    : <span key={member.id} aria-label={`Kein Profilbild für ${member.name}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-emerald-300">{member.name.slice(0, 1).toUpperCase()}</span>)}
                  <span className="truncate">{r.name}</span>
                  {r.tied && <span className="text-[10px] font-bold text-amber-400">T</span>}
                </span>
              </td>
              <td className="py-1.5 px-2 text-center table-cell-num font-bold text-emerald-400">{r.wins}</td>
              {showPlayed && <td className="py-1.5 px-2 text-center table-cell-num text-slate-400">{r.played}</td>}
              <td className="py-1.5 px-2 text-center table-cell-num">{r.damageDealt}</td>
              <td className="py-1.5 px-2 text-center table-cell-num text-slate-400">{r.damageTaken}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
