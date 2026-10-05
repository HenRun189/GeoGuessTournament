// Setup wizard: name → size → participants → (teams) → structure preview → create.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatForSize } from '@gt/shared';
import { api } from '../lib/api';

interface ParticipantRow {
  name: string;
  country: string;
  abbreviation: string;
}

const fmtSize = (n: number) => `${n} Teilnehmer`;

export default function CreatePage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('GeoGuessr Turnier #1');
  const [size, setSize] = useState(8);
  const [rows, setRows] = useState<ParticipantRow[]>(() =>
    Array.from({ length: 8 }, (_, i) => ({ name: '', country: '', abbreviation: '' })),
  );
  const [teams, setTeams] = useState<{ name: string; a: number | null; b: number | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const info = useMemo(() => formatForSize(size), [size]);
  const teamCount = size / 2;

  const setSizeAndRows = (n: number) => {
    setSize(n);
    setRows((prev) => {
      const next = [...prev];
      while (next.length < n) next.push({ name: '', country: '', abbreviation: '' });
      next.length = n;
      return next;
    });
    setTeams([]);
  };

  const needsTeams = info.unitKind === 'team';

  const initTeams = () => {
    setTeams(
      Array.from({ length: teamCount }, (_, i) => ({ name: `Team ${i + 1}`, a: i * 2, b: i * 2 + 1 })),
    );
  };

  const valid = useMemo(() => {
    const names = rows.map((r) => r.name.trim()).filter(Boolean);
    return names.length === size && new Set(names.map((n) => n.toLowerCase())).size === names.length;
  }, [rows, size]);

  const teamsValid = useMemo(() => {
    if (!needsTeams) return true;
    if (!teams.length) return false;
    const used: number[] = [];
    for (const t of teams) {
      if (t.a === null || t.b === null || t.a === t.b) return false;
      used.push(t.a, t.b);
    }
    return used.length === size && new Set(used).size === size;
  }, [teams, needsTeams, size]);

  const structureText = useMemo(() => {
    if (info.format === 'round_robin') {
      return `Jeder spielt gegen alle (${info.unitKind === 'team' ? 'Teams' : 'Spieler'}). Dann Halbfinale: 1 gegen 4, 2 gegen 3 → Finale.`;
    }
    if (info.format === 'random_three') {
      return `Jedes ${info.unitKind === 'team' ? 'Team' : 'Spieler'} bekommt 3 zufällige Gegner (dauerhaft gespeichert). Dann Halbfinale: 1 gegen 4, 2 gegen 3 → Finale. Plätze 5+ eliminiert.`;
    }
    return `Zwei Gruppen à ${size / 2}. Rundenspiel innen. Dann 1A gegen 2B, 1B gegen 2A → Finale. Beide dritte Plätze eliminiert.`;
  }, [info, size]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const participants = rows.map((r, i) => ({
        name: r.name.trim(),
        country: r.country.trim() || null,
        abbreviation: r.abbreviation.trim() || null,
        id: `p_${i + 1}`,
      }));
      const body = {
        name: name.trim(),
        participantCount: size,
        participants,
        teams: needsTeams
          ? teams.map((t, i) => ({
              name: t.name.trim() || `Team ${i + 1}`,
              memberIds: [participants[t.a as number].id, participants[t.b as number].id],
            }))
          : null,
      };
      const { id } = await api.createTournament(body);
      navigate(`/admin/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erstellen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <button onClick={() => navigate(-1)} className="btn-ghost mb-6">
        ← Zurück
      </button>
      <h1 className="mb-6 text-2xl font-black">Turnier erstellen</h1>

      <div className="mb-6 flex gap-2 text-xs font-bold uppercase tracking-wider">
        {['Name', 'Größe', 'Teilnehmer', needsTeams ? 'Teams' : 'Bestätigen'].map((s, i) => {
          // 4–7 and 9–11 players skip team configuration entirely: the step
          // indicator shows only Name, Größe, Teilnehmer, Bestätigen — the wizard
          // jumps straight from the participant row to the structure preview.
          const stepNum = needsTeams ? i + 1 : i === 3 ? 3 : i + 1;
          const active = needsTeams
            ? step === i + 1
            : step === i + 1 || (i === 3 && step === 4);
          void stepNum;
          return (
            <div key={s} className={`rounded px-2 py-1 ${active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
              {i + 1}. {s}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className="card space-y-4">
          <div>
            <label className="label">Turniername</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="GeoGuessr Turnier #3" />
          </div>
          <button className="btn-primary" disabled={!name.trim()} onClick={() => setStep(2)}>
            Weiter: Teilnehmer
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-4">
          <div>
            <label className="label">Anzahl der Teilnehmer (4–12)</label>
            <div className="flex flex-wrap gap-2">
              {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                <button
                  key={n}
                  onClick={() => setSizeAndRows(n)}
                  className={`h-11 w-11 rounded-lg text-base font-black ${
                    size === n ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
            <span className="font-bold text-emerald-400">{info.unitKind === 'team' ? '2er-Teams-Format' : 'Einzelspieler'}</span>{' '}
            — {structureText}
          </div>
          <button className="btn-primary" onClick={() => setStep(3)}>
            Weiter: Teilnehmer eingeben
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="card space-y-3">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[2rem_2fr_1fr_1fr] gap-2">
                <div className="flex items-center justify-center rounded bg-slate-800 text-sm font-bold text-slate-400">{i + 1}</div>
                <input
                  className="input"
                  placeholder={`Spieler ${i + 1} Name`}
                  value={r.name}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...r, name: e.target.value };
                    setRows(next);
                  }}
                />
                <input
                  className="input"
                  placeholder="Land (z. B. DE)"
                  value={r.country}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...r, country: e.target.value };
                    setRows(next);
                  }}
                />
                <input
                  className="input"
                  placeholder="Abk."
                  value={r.abbreviation}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...r, abbreviation: e.target.value };
                    setRows(next);
                  }}
                />
              </div>
            ))}
          </div>
          {!valid && <div className="text-xs text-amber-400">Alle {size} Namen sind erforderlich und eindeutig.</div>}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setStep(2)}>
              Zurück
            </button>
            <button className="btn-primary" disabled={!valid} onClick={() => setStep(needsTeams ? 4 : 5)}>
              {needsTeams ? 'Weiter: Teams erstellen' : 'Weiter: bestätigen'}
            </button>
          </div>
        </div>
      )}

      {step === 4 && needsTeams && (
        <div className="card space-y-3">
          {!teams.length && (
            <button className="btn-secondary" onClick={initTeams}>
              Erstelle {teamCount} Teams (Paaare per Auto-fill)
            </button>
          )}
          {teams.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr] gap-2">
              <input
                className="input"
                value={t.name}
                onChange={(e) => {
                  const next = [...teams];
                  next[i] = { ...t, name: e.target.value };
                  setTeams(next);
                }}
              />
              <select
                className="input"
                value={t.a ?? ''}
                onChange={(e) => {
                  const next = [...teams];
                  next[i] = { ...t, a: e.target.value === '' ? null : Number(e.target.value) };
                  setTeams(next);
                }}
              >
                <option value="">— Spieler —</option>
                {rows.map((r, ri) => (
                  <option key={ri} value={ri}>
                    {r.name || `Spieler ${ri + 1}`}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={t.b ?? ''}
                onChange={(e) => {
                  const next = [...teams];
                  next[i] = { ...t, b: e.target.value === '' ? null : Number(e.target.value) };
                  setTeams(next);
                }}
              >
                <option value="">— Spieler —</option>
                {rows.map((r, ri) => (
                  <option key={ri} value={ri}>
                    {r.name || `Spieler ${ri + 1}`}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {!teamsValid && <div className="text-xs text-amber-400">Jeder der {size} Spieler muss genau einmal in {teamCount} Teams zugewiesen werden.</div>}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setStep(3)}>
              Zurück
            </button>
            <button className="btn-primary" disabled={!teamsValid} onClick={() => setStep(5)}>
              Weiter: bestätigen
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="card space-y-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">Struktur</div>
            <div className="mt-2 space-y-1 text-sm text-slate-300">
              <div>
                <span className="font-bold">{size} Teilnehmer</span> · {info.unitKind === 'team' ? `${teamCount} Teams × 2 Spieler` : 'Einzelspieler'}
              </div>
              <div>{structureText}</div>
              <div className="text-slate-400">Rangliste: Siege → Schaden verursacht (mehr) → Schaden genommen (weniger).</div>
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-emerald-400">Teams</div>
            <div className="space-y-0.5 text-sm text-slate-300">
              {rows.map((r, i) => (
                <div key={i}>
                  {i + 1}. {r.name.trim()}
                  {r.country.trim() ? ` · ${r.country.trim()}` : ''}
                </div>
              ))}
            </div>
          </div>
          {error && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setStep(needsTeams ? 4 : 3)}>
              Zurück
            </button>
            <button className="btn-primary" disabled={busy} onClick={() => void create()}>
              {busy ? 'Erstelle…' : 'TURMIER ERSTELLEN'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
