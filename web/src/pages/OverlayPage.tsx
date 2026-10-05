// OBS overlay: transparent, auto-rotating views (next matches / table / bracket / current match).

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { TournamentStateDTO, OverlayView } from '@gt/shared';
import { unitName, useTournamentState } from '../lib/api';
import StandingsTable, { flagEmoji } from '../components/StandingsTable';
import Bracket from '../components/Bracket';

const STAGE_LABELS: Record<string, string> = {
  PRELIMINARY: 'Vorrunde',
  SEMIFINALS: 'Halbfinale',
  FINAL: 'Finale',
};

export default function OverlayPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useTournamentState(id ?? null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!state) return;
    const interval = Math.max(5, state.settings.rotationIntervalSec) * 1000;
    const t = setInterval(() => setTick((x) => x + 1), interval);
    return () => clearInterval(t);
  }, [state?.settings.rotationIntervalSec, state?.id, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useMemo<OverlayView>(() => {
    if (!state) return 'next_matches';
    const mode = state.settings.overlayMode;
    if (mode && mode !== 'auto') return mode;
    // auto rotation
    const inKnockout = state.state === 'SEMIFINALS' || state.state === 'FINAL' || state.state === 'FINISHED';
    if (inKnockout) {
      const seq: OverlayView[] = ['bracket', 'current_match'];
      return seq[tick % seq.length];
    }
    const seq: OverlayView[] = ['next_matches', 'table'];
    return seq[tick % seq.length];
  }, [state, tick]);

  if (!state) return null;

  const theme = state.settings.theme;
  const dark = theme === 'dark';
  const text = dark ? 'text-slate-100' : 'text-slate-900';
  const panel = dark ? 'bg-slate-900/85 border-slate-700' : 'bg-white/85 border-slate-300';
  const accent = dark ? 'text-emerald-400' : 'text-emerald-600';
  const muted = dark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`overlay-root min-h-screen ${text}`} style={{ background: state.settings.transparent ? 'transparent' : dark ? '#0f172a' : '#f8fafc' }}>
      <div className={state.settings.compact ? 'mx-auto max-w-3xl p-2' : 'mx-auto max-w-5xl p-4'}>
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
      </div>
    </div>
  );
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
  const upcoming = state.matches.filter((m) => m.status === 'waiting' && m.aUnitId && m.bUnitId).slice(0, 5);
  return (
    <div className={`rounded-xl border ${panel} p-4`}>
      <div className={`mb-2 text-sm font-bold uppercase tracking-wider ${accent}`}>Nächste Spiele</div>
      {upcoming.length === 0 && <div className={`text-sm ${muted}`}>Keine nächsten Spiele</div>}
      <div className="space-y-1.5">
        {upcoming.map((m) => (
          <div key={m.id} className="flex items-center gap-3 text-lg font-bold">
            <span className="flex items-center gap-1.5">
              {state.settings.showFlags && flagEmoji(state.units.find((u) => u.id === m.aUnitId)?.country ?? null)}
              {unitName(state, m.aUnitId)}
            </span>
            <span className="text-xs font-black uppercase text-slate-500">gegen</span>
            <span className="flex items-center gap-1.5">
              {state.settings.showFlags && flagEmoji(state.units.find((u) => u.id === m.bUnitId)?.country ?? null)}
              {unitName(state, m.bUnitId)}
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
    <div className={`rounded-xl border ${panel} p-4`}>
      <div className={`mb-2 text-sm font-bold uppercase tracking-wider ${accent}`}>
        {groups.length ? 'Gruppentabelle' : 'Tabellenstellung'}
      </div>
      {groups.length >= 2 ? (
        <div className="grid grid-cols-2 gap-6">
          {groups.map((g) => (
            <StandingsTable key={g.id} title={g.name} rows={state.groupStandings[g.id] ?? []} showFlags={state.settings.showFlags} compact={state.settings.compact} />
          ))}
        </div>
      ) : (
        <StandingsTable rows={state.standings} showFlags={state.settings.showFlags} compact={state.settings.compact} />
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
    <div className={`rounded-xl border ${panel} p-4`}>
      <div className={`mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${accent}`}>
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
        {current.label}
      </div>
      <div className="flex items-center justify-center gap-6 py-2 text-center">
        <div className="flex-1 truncate text-3xl font-black">
          {state.settings.showFlags && flagEmoji(state.units.find((u) => u.id === current.aUnitId)?.country ?? null)}{' '}
          {unitName(state, current.aUnitId)}
        </div>
        <div className="text-lg font-black uppercase text-slate-500">gegen</div>
        <div className="flex-1 truncate text-3xl font-black">
          {state.settings.showFlags && flagEmoji(state.units.find((u) => u.id === current.bUnitId)?.country ?? null)}{' '}
          {unitName(state, current.bUnitId)}
        </div>
      </div>
    </div>
  );
}
