// Read-side helpers: build the full TournamentStateDTO the UI consumes.

import type {
  GroupDTO,
  MatchDTO,
  KnockoutDTO,
  PlayerViewDTO,
  SlotRef,
  StandingRowDTO,
  TournamentState,
  TournamentStateDTO,
  UnitDTO,
  PresentationDeckDTO,
} from '@gt/shared';
import { DEFAULT_PRESENTATION_DECKS } from '@gt/shared';
import { computeStandings, formatInfo, type StandingRow, type UnitPlan } from '@gt/engine';
import { prisma } from './db.js';

export class ServiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function unitPlansFor(ids: string[]): UnitPlan[] {
  return ids.map((uid) => ({ id: uid, kind: 'player', name: '', country: null, abbreviation: null, memberIds: [uid] }));
}

export function markTies(rows: StandingRowDTO[]): void {
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.wins === b.wins && a.damageDealt === b.damageDealt && a.damageTaken === b.damageTaken) {
        a.tied = true;
        b.tied = true;
      } else break;
    }
  }
}

export function standingsFromMatches(
  unitIds: string[],
  finished: { aUnitId: string; bUnitId: string; winnerUnitId: string; aDamageDealt: number; bDamageDealt: number }[],
  nameOf: (unitId: string) => { name: string; country: string | null; abbreviation: string | null },
): StandingRowDTO[] {
  const rows: StandingRow[] = computeStandings(unitPlansFor(unitIds), finished);
  const out = rows.map((r, i) => {
    const meta = nameOf(r.unitId);
    return {
      position: i + 1,
      unitId: r.unitId,
      name: meta.name,
      country: meta.country,
      abbreviation: meta.abbreviation,
      played: r.played,
      wins: r.wins,
      damageDealt: r.damageDealt,
      damageTaken: r.damageTaken,
      tied: false,
    };
  });
  markTies(out);
  return out;
}

export function knockoutPlanFor(format: string, groups: { id: string; name: string }[]): {
  sf1: { a: SlotRef; b: SlotRef };
  sf2: { a: SlotRef; b: SlotRef };
} {
  if (format === 'groups_of_3') {
    const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name));
    const gA = sorted[0];
    const gB = sorted[1];
    return {
      sf1: { a: { kind: 'group', groupId: gA.id, groupPosition: 1 }, b: { kind: 'group', groupId: gB.id, groupPosition: 2 } },
      sf2: { a: { kind: 'group', groupId: gB.id, groupPosition: 1 }, b: { kind: 'group', groupId: gA.id, groupPosition: 2 } },
    };
  }
  return {
    sf1: { a: { kind: 'standing', standing: 1 }, b: { kind: 'standing', standing: 4 } },
    sf2: { a: { kind: 'standing', standing: 2 }, b: { kind: 'standing', standing: 3 } },
  };
}

export async function getTournamentState(tournamentId: string): Promise<TournamentStateDTO> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      units: { include: { members: { include: { participant: true } } } },
      groups: { include: { members: true } },
      matches: { include: { result: true } },
      settings: true,
    },
  });
  if (!t) throw new ServiceError('Tournament not found', 404);

  const units: UnitDTO[] = t.units.map((u) => {
    const ownOpenMatches = t.matches.filter((match) => match.status !== 'finished' && (match.aUnitId === u.id || match.bUnitId === u.id));
    const ownNextMatch = ownOpenMatches.find((match) => match.status === 'live') ?? [...ownOpenMatches].sort((a, b) => {
      const order = (match: typeof a) => (match.stage === 'PRELIMINARY' ? 0 : match.stage === 'SEMIFINALS' ? 1 : 2) * 10000 + match.orderInStage;
      return order(a) - order(b);
    })[0];
    const readinessIsCurrent = Boolean(ownNextMatch && u.readinessMatchId === ownNextMatch.id);
    return {
      id: u.id,
      kind: u.kind as UnitDTO['kind'],
      name: u.name,
      abbreviation: u.abbreviation,
      country: u.country,
      members: u.members.map((m) => ({ id: m.participantId, name: m.participant.name, imageUrl: m.participant.imagePath ? `/api/uploads/${m.participant.imagePath}` : null })),
      readiness: (readinessIsCurrent ? u.readiness : 'waiting') as UnitDTO['readiness'],
      readinessMatchId: readinessIsCurrent ? u.readinessMatchId : null,
      problemReport: u.problemMessage && u.problemCreatedAt ? {
        message: u.problemMessage,
        createdAt: u.problemCreatedAt.toISOString(),
        resolved: u.problemResolved,
      } : null,
    };
  });
  const unitById = new Map(units.map((u) => [u.id, u]));
  const unitIds = units.map((u) => u.id);
  const meta = (uid: string) => {
    const u = unitById.get(uid);
    return { name: u?.name ?? uid, country: u?.country ?? null, abbreviation: u?.abbreviation ?? null };
  };

  const prelimFinished = t.matches
    .filter((m) => m.stage === 'PRELIMINARY' && m.status === 'finished' && m.result && m.aUnitId && m.bUnitId)
    .map((m) => ({
      aUnitId: m.aUnitId as string,
      bUnitId: m.bUnitId as string,
      winnerUnitId: m.result!.winnerUnitId,
      aDamageDealt: m.result!.aDamageDealt,
      bDamageDealt: m.result!.bDamageDealt,
    }));

  const standings = standingsFromMatches(unitIds, prelimFinished, meta);

  const groups: GroupDTO[] = t.groups.map((g) => ({
    id: g.id,
    name: g.name,
    unitIds: g.members.map((m) => m.unitId),
  }));
  const groupStandings: Record<string, StandingRowDTO[]> = {};
  for (const g of groups) {
    const gFinished = prelimFinished.filter(
      (m) => g.unitIds.includes(m.aUnitId) && g.unitIds.includes(m.bUnitId),
    );
    groupStandings[g.id] = standingsFromMatches(g.unitIds, gFinished, meta);
  }

  const matches: MatchDTO[] = t.matches.map((m) => {
    let slotA: SlotRef | null = null;
    let slotB: SlotRef | null = null;
    try {
      slotA = m.slotA ? (JSON.parse(m.slotA) as SlotRef) : null;
      slotB = m.slotB ? (JSON.parse(m.slotB) as SlotRef) : null;
    } catch {
      /* ignore corrupt slots */
    }
    return {
      id: m.id,
      stage: m.stage as MatchDTO['stage'],
      round: m.round,
      orderInStage: m.orderInStage,
      label: m.label,
      aUnitId: m.aUnitId,
      bUnitId: m.bUnitId,
      status: m.status as MatchDTO['status'],
      result: m.result
        ? {
            winnerUnitId: m.result.winnerUnitId,
            aDamageDealt: m.result.aDamageDealt,
            bDamageDealt: m.result.bDamageDealt,
            aDamageTaken: m.result.bDamageDealt,
            bDamageTaken: m.result.aDamageDealt,
          }
        : null,
      slotA,
      slotB,
    };
  });

  // Keep the engine's schedule order consistent across every surface; stage strings
  // sort lexicographically in SQLite, which would otherwise put FINAL first.
  const stageOrder = (stage: MatchDTO['stage']) => stage === 'PRELIMINARY' ? 0 : stage === 'SEMIFINALS' ? 1 : 2;
  matches.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || a.orderInStage - b.orderInStage);

  const plan = knockoutPlanFor(t.format, groups);
  const sf1 = matches.find((m) => m.stage === 'SEMIFINALS' && m.round === 1) ?? null;
  const sf2 = matches.find((m) => m.stage === 'SEMIFINALS' && m.round === 2) ?? null;
  const finalMatch = matches.find((m) => m.stage === 'FINAL') ?? null;

  const resolve = (slot: SlotRef): StandingRowDTO | undefined => {
    if (slot.kind === 'standing') return standings[(slot.standing ?? 1) - 1];
    return groupStandings[slot.groupId ?? '']?.[(slot.groupPosition ?? 1) - 1];
  };

  const sf1A = sf1?.aUnitId ?? resolve(plan.sf1.a)?.unitId ?? null;
  const sf1B = sf1?.bUnitId ?? resolve(plan.sf1.b)?.unitId ?? null;
  const sf2A = sf2?.aUnitId ?? resolve(plan.sf2.a)?.unitId ?? null;
  const sf2B = sf2?.bUnitId ?? resolve(plan.sf2.b)?.unitId ?? null;
  const sf1Winner = sf1?.result?.winnerUnitId ?? null;
  const sf2Winner = sf2?.result?.winnerUnitId ?? null;

  const preliminaryEliminated =
    t.format === 'groups_of_3'
      ? groups.flatMap((g) => (groupStandings[g.id] ?? []).slice(2).map((r) => r.unitId))
      : standings.slice(4).map((r) => r.unitId);
  const knockoutLosers = matches
    .filter((m) => m.stage !== 'PRELIMINARY' && m.status === 'finished' && m.result)
    .map((m) => (m.result!.winnerUnitId === m.aUnitId ? m.bUnitId : m.aUnitId))
    .filter((unitId): unitId is string => Boolean(unitId));
  const eliminatedUnitIds = preliminaryEliminated;

  const knockout: KnockoutDTO = {
    sf1: sf1 ? { ...sf1, aUnitId: sf1.aUnitId ?? sf1A, bUnitId: sf1.bUnitId ?? sf1B } : null,
    sf2: sf2 ? { ...sf2, aUnitId: sf2.aUnitId ?? sf2A, bUnitId: sf2.bUnitId ?? sf2B } : null,
    final: finalMatch ? { ...finalMatch, aUnitId: finalMatch.aUnitId ?? sf1Winner, bUnitId: finalMatch.bUnitId ?? sf2Winner } : null,
    championUnitId: finalMatch?.result?.winnerUnitId ?? null,
    eliminatedUnitIds,
  };

  const playerViewFor = (unitId: string): { view: PlayerViewDTO; matches: MatchDTO[] } => {
    const unit = units.find((u) => u.id === unitId);
    if (!unit) return { view: nullView, matches: [] };
    // Matches involving this player/team: preliminary matches reference the unit
    // directly (aUnitId/bUnitId are resolved), so filtering on aUnitId/bUnitId is enough.
    const scheduleOrder = (match: MatchDTO) =>
      (match.stage === 'PRELIMINARY' ? 0 : match.stage === 'SEMIFINALS' ? 1 : 2) * 10000 + match.orderInStage;
    const ownMatches = matches.filter((m) => m.aUnitId === unitId || m.bUnitId === unitId).sort(
      (x, y) => scheduleOrder(x) - scheduleOrder(y),
    );
    const memberNames = unit.kind === 'team' ? unit.members.map((m) => m.name) : [unit.name];
    const groups = t.groups
      .filter((g) => g.members.some((member) => member.unitId === unitId))
      .map((g) => ({ id: g.id, name: g.name }));

    // Derive position from the same central schedule used by every surface.
    let status: PlayerViewDTO['status'] = 'nothing_yet';
    let gamesBeforeNext = 0;
    const active = ownMatches.find((m) => m.status === 'live');
    const next = active ?? ownMatches.find((m) => m.status === 'waiting');
    if (active) {
      status = 'dran';
    } else if (next) {
      gamesBeforeNext = matches.filter(
        (m) => (m.status === 'waiting' || m.status === 'live') && m.aUnitId && m.bUnitId && scheduleOrder(m) < scheduleOrder(next),
      ).length;
      status = gamesBeforeNext === 0 ? 'next' : 'waiting';
    } else {
      const reachedKnockout = t.state === 'SEMIFINALS' || t.state === 'FINAL' || t.state === 'FINISHED';
      const eliminated = reachedKnockout && (eliminatedUnitIds.includes(unitId) || knockoutLosers.includes(unitId));
      status = eliminated ? 'eliminated' : ownMatches.length > 0 ? 'played' : 'nothing_yet';
    }

    const view: PlayerViewDTO = {
      id: unit.id,
      name: unit.name,
      playerId: unit.id,
      kind: unit.kind,
      format: t.format as TournamentStateDTO['format'],
      memberNames,
      groups,
      nextOwnMatch: ownMatches.find((m) => m.status === 'live') ?? ownMatches.find((m) => m.status === 'waiting') ?? null,
      ownMatches,
      status,
      readiness: unit.readiness,
      problemReport: unit.problemReport,
      gamesBeforeNext,
    };
    return { view, matches: ownMatches };
  };

  const nullView: PlayerViewDTO = {
    id: '',
    name: '',
    playerId: '',
    kind: 'player',
    format: 'round_robin',
    memberNames: [],
    groups: [],
    nextOwnMatch: null,
    ownMatches: [],
    status: 'nothing_yet',
    readiness: 'waiting',
    problemReport: null,
    gamesBeforeNext: 0,
  };

  return {
    id: t.id,
    name: t.name,
    state: t.state as TournamentState,
    format: t.format as TournamentStateDTO['format'],
    unitKind: t.unitKind as TournamentStateDTO['unitKind'],
    participantCount: t.participantCount,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    units,
    groups,
    matches,
    standings,
    groupStandings,
    knockout,
    presentation: {
      active: t.presentationActive,
      activeDeckId: t.presentationDeckId,
      currentIndex: t.presentationIndex,
      decks: (() => {
        try {
          const decks: unknown = JSON.parse(t.presentationSlides);
          if (Array.isArray(decks) && decks.length && decks.every((deck) => deck && typeof deck.id === 'string' && typeof deck.title === 'string' && Array.isArray(deck.slides))) return decks as PresentationDeckDTO[];
        } catch { /* use defaults for pre-migration or malformed legacy data */ }
        return DEFAULT_PRESENTATION_DECKS;
      })(),
    },
    presentationVideo: t.presentationVideoPath
      ? { url: `/api/uploads/${t.presentationVideoPath}`, active: t.presentationVideoActive }
      : null,
    resultScreen: t.resultScreenMatchId && t.resultScreenUntil && t.resultScreenUntil.getTime() > Date.now()
      ? { matchId: t.resultScreenMatchId, until: t.resultScreenUntil.toISOString() }
      : null,
    settings: {
      autoRotation: t.settings?.autoRotation ?? true,
      rotationIntervalSec: t.settings?.rotationIntervalSec ?? 30,
      showLogo: t.settings?.showLogo ?? true,
      showTournamentName: t.settings?.showTournamentName ?? true,
      showFlags: t.settings?.showFlags ?? true,
      compact: t.settings?.compact ?? false,
      transparent: t.settings?.transparent ?? true,
      rotationViews: (() => {
        const defaults: TournamentStateDTO['settings']['rotationViews'] = ['next_matches', 'all_matches', 'table', 'presentation'];
        try {
          const views: unknown = JSON.parse(t.settings?.rotationViews ?? JSON.stringify(defaults));
          const allowed: TournamentStateDTO['settings']['rotationViews'] = ['next_matches', 'all_matches', 'table', 'bracket', 'current_match', 'presentation'];
          const valid = Array.isArray(views) ? views.filter((view): view is typeof allowed[number] => typeof view === 'string' && allowed.includes(view as typeof allowed[number])) : [];
          return valid.length ? [...new Set(valid)] : defaults;
        } catch { return defaults; }
      })(),
      theme: 'dark',
      overlayMode: (t.settings?.overlayMode ?? 'auto') as TournamentStateDTO['settings']['overlayMode'],
    },
    currentMatchId: t.currentMatchId,
    seed: t.seed,
    // player views (derived, no new fields persisted)
    playerViews: Object.fromEntries(
      units.map((u) => [u.id, playerViewFor(u.id).view as PlayerViewDTO]),
    ),
  };
}
