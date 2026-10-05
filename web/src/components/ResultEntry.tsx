// Fast result entry: winner toggle + damage inputs + single SAVE action.

import { useEffect, useState } from 'react';
import type { TournamentStateDTO } from '@gt/shared';
import { api, unitName } from '../lib/api';

interface Props {
  state: TournamentStateDTO;
  matchId: string;
  onSaved: () => void;
}

export default function ResultEntry({ state, matchId, onSaved }: Props) {
  const match = state.matches.find((m) => m.id === matchId);
  const [winner, setWinner] = useState<string | null>(null);
  const [aDmg, setADmg] = useState('');
  const [bDmg, setBDmg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWinner(null);
    setADmg('');
    setBDmg('');
    setError(null);
  }, [matchId]);

  if (!match) return null;
  const a = match.aUnitId;
  const b = match.bUnitId;
  if (!a || !b) return <div className="text-sm text-slate-500">Teams not decided yet for this match.</div>;

  const save = async () => {
    setError(null);
    if (!winner) {
      setError('Zuerst einen Sieger auswählen');
      return;
    }
    const av = aDmg.trim() === '' ? 0 : Number(aDmg);
    const bv = bDmg.trim() === '' ? 0 : Number(bDmg);
    if (!Number.isFinite(av) || av < 0 || !Number.isInteger(av)) {
      setError('Schaden von Team A muss eine ganze Zahl ≥ 0 sein');
      return;
    }
    if (!Number.isFinite(bv) || bv < 0 || !Number.isInteger(bv)) {
      setError('Schaden von Team B muss eine ganze Zahl ≥ 0 sein');
      return;
    }
    setSaving(true);
    try {
      await api.saveResult(state.id, matchId, { winnerUnitId: winner, aDamageDealt: av, bDamageDealt: bv });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          onClick={() => setWinner(a)}
          className={`rounded-lg border px-3 py-3 text-left text-base font-bold transition-colors ${
            winner === a ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : 'border-slate-700 bg-slate-900 hover:border-slate-500'
          }`}
        >
          {unitName(state, a)}
        </button>
        <span className="text-lg font-black text-slate-500">gegen</span>
        <button
          onClick={() => setWinner(b)}
          className={`rounded-lg border px-3 py-3 text-right text-base font-bold transition-colors ${
            winner === b ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : 'border-slate-700 bg-slate-900 hover:border-slate-500'
          }`}
        >
          {unitName(state, b)}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Schaden {unitName(state, a)}</label>
          <input
            className="input table-cell-num text-lg"
            inputMode="numeric"
            placeholder="0"
            value={aDmg}
            onChange={(e) => setADmg(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
        </div>
        <div>
          <label className="label">Schaden {unitName(state, b)}</label>
          <input
            className="input table-cell-num text-lg"
            inputMode="numeric"
            placeholder="0"
            value={bDmg}
            onChange={(e) => setBDmg(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-400">{error}</div>}

      <button onClick={() => void save()} disabled={saving} className="btn-primary w-full py-3 text-base">
        {saving ? 'Wird gespeichert…' : 'ERGEBNIS SPEICHERN'}
      </button>
    </div>
  );
}
