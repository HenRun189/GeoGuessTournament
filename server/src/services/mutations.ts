// Write-side mutations: create, results, undo, state control, stage advancement, settings, demo.

import type { TournamentState, OverlayOverrideDTO, Stage } from '@gt/shared';
import { buildSchedule, buildUnits, formatInfo } from '@gt/engine';
import { nanoid } from 'nanoid';
import { prisma, broadcast } from './db.js';
import { ServiceError, getTournamentState, knockoutPlanFor } from './state.js';

function id(prefix: string): string {
  return `${prefix}_${nanoid(8)}`;
}

export interface CreateTournamentArgs {
  name: string;
  participantCount: number;
  participants: { id?: string; name: string; country?: string | null; abbreviation?: string | null }[];
  teams?: { id?: string; name: string; country?: string | null; abbreviation?: string | null; memberIds: string[] }[] | null;
  isDemo?: boolean;
}

async function emit(tournamentId: string): Promise<void> {
  const state = await getTournamentState(tournamentId);
  broadcast(tournamentId, { type: 'state', tournamentId, state });
}

function pingUnit(tournamentId: string, unitId: string, matchId: string | null, reason: 'manual' | 'match_activation'): void {
  const activationId = `${reason}:${matchId ?? 'manual'}:${nanoid(12)}:${unitId}`;
  broadcast(tournamentId, { type: 'ping', tournamentId, unitId, activationId, reason, matchId });
}

function matchOrder(match: { stage: string; orderInStage: number }): number {
  const stageOrder: Record<string, number> = { PRELIMINARY: 0, SEMIFINALS: 1, FINAL: 2 };
  return (stageOrder[match.stage] ?? 3) * 10000 + match.orderInStage;
}

// ---------- create ----------

export async function createTournament(args: CreateTournamentArgs): Promise<string> {
  const size = args.participantCount;
  if (!Number.isInteger(size) || size < 4 || size > 12) {
    throw new ServiceError(`Unsupported participant count: ${size} (must be 4-12)`);
  }
  const name = args.name?.trim();
  if (!name) throw new ServiceError('Tournament name is required');

  const participants = (args.participants ?? []).map((p) => ({ ...p, name: (p.name ?? '').trim() }));
  if (participants.length !== size) {
    throw new ServiceError(`Expected ${size} participants, got ${participants.length}`);
  }
  if (participants.some((p) => !p.name)) throw new ServiceError('Every participant needs a name');
  const lowered = participants.map((p) => p.name.toLowerCase());
  if (new Set(lowered).size !== lowered.length) throw new ServiceError('Participant names must be unique');

  const info = formatInfo(size);
  // Client-supplied ids are treated as within-request references only: they are
  // remapped to fresh server ids so tournaments can never collide on ids.
  const idMap = new Map<string, string>();
  const parts = participants.map((p) => {
    const realId = id('p');
    if (p.id) idMap.set(p.id, realId);
    return { ...p, id: realId };
  });

  let teamInputs = args.teams?.map((t) => ({
    ...t,
    id: t.id ?? id('team'),
    name: (t.name ?? '').trim(),
    memberIds: t.memberIds.map((m) => idMap.get(m) ?? m),
  })) ?? null;
  if (info.unitKind === 'team' && !teamInputs) {
    // Auto-pair is NOT allowed by default; moderator must define teams in the wizard.
    throw new ServiceError('This tournament size requires 2-player teams. Define them in the wizard.');
  }

  const { participants: dbParticipants, units } = buildUnits(parts, teamInputs, size);

  // Groups for sizes 6 and 12: alternate entry order into 2 groups (moderator controls seeding by order).
  const groups: { id: string; name: string; unitIds: string[] }[] = [];
  if (info.groups === 2) {
    const ga: string[] = [];
    const gb: string[] = [];
    units.forEach((u, i) => (i % 2 === 0 ? ga : gb).push(u.id));
    groups.push({ id: id('g'), name: 'Group A', unitIds: ga });
    groups.push({ id: id('g'), name: 'Group B', unitIds: gb });
  }

  const schedule = buildSchedule(units, size, {
    groups: groups.length ? groups : undefined,
  });

  const shortId = nanoid(8);
  await prisma.tournament.create({
    data: {
      id: shortId,
      name,
      state: 'SETUP',
      format: info.format,
      unitKind: info.unitKind,
      participantCount: size,
      seed: schedule.seed,
      isDemo: args.isDemo ?? false,
      participants: {
        create: dbParticipants.map((p) => ({
          id: p.id,
          name: p.name,
          country: p.country,
          abbreviation: p.abbreviation,
        })),
      },
      units: {
        create: units.map((u) => ({
          id: u.id,
          kind: u.kind,
          name: u.name,
          country: u.country,
          abbreviation: u.abbreviation,
          members: { create: u.memberIds.map((mid) => ({ participantId: mid })) },
        })),
      },
      groups: {
        create: schedule.groups.map((g) => ({
          id: g.id,
          name: g.name,
          members: { create: g.unitIds.map((uid) => ({ unitId: uid })) },
        })),
      },
      matches: {
        create: schedule.matches.map((m, i) => ({
          id: id('m'),
          stage: m.stage,
          round: m.round,
          orderInStage: i + 1,
          label: `Match ${i + 1}`,
          aUnitId: m.aUnitId,
          bUnitId: m.bUnitId,
          status: 'waiting',
        })),
      },
      settings: { create: {} },
    },
  });

  return shortId;
}

// ---------- results ----------

export async function saveResult(
  tournamentId: string,
  matchId: string,
  input: { winnerUnitId: string; aDamageDealt: number; bDamageDealt: number },
): Promise<void> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { matches: true },
  });
  if (!t) throw new ServiceError('Tournament not found', 404);
  if (t.state === 'SETUP') throw new ServiceError('Tournament has not started yet');
  if (t.state === 'FINISHED') throw new ServiceError('Tournament is finished');
  if (t.paused) throw new ServiceError('Tournament is paused — resume it to save results');

  const match = t.matches.find((m) => m.id === matchId);
  if (!match) throw new ServiceError('Match not found', 404);
  if (match.stage !== 'PRELIMINARY' && !match.aUnitId) {
    throw new ServiceError('Knockout match has no confirmed team A yet');
  }
  if (match.status === 'finished') {
    throw new ServiceError('Result already saved — undo it first to change it');
  }

  const { winnerUnitId } = input;
  const a = input.aDamageDealt;
  const b = input.bDamageDealt;
  if (winnerUnitId !== match.aUnitId && winnerUnitId !== match.bUnitId) {
    throw new ServiceError('Winner must be one of the two teams in the match');
  }
  if (!Number.isFinite(a) || a < 0) throw new ServiceError('Damage for team A must be ≥ 0');
  if (!Number.isFinite(b) || b < 0) throw new ServiceError('Damage for team B must be ≥ 0');
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    throw new ServiceError('Damage values must be whole numbers');
  }

  await prisma.$transaction([
    prisma.matchResult.upsert({
      where: { matchId: match.id },
      create: { matchId: match.id, winnerUnitId, aDamageDealt: a, bDamageDealt: b },
      update: { winnerUnitId, aDamageDealt: a, bDamageDealt: b },
    }),
    prisma.match.update({ where: { id: match.id }, data: { status: 'finished' } }),
  ]);

  if (t.paused) {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { paused: false } });
  }

  await advanceIfComplete(tournamentId);

  // Continue automatically only when the finished match was the explicit current
  // match. A newer currentMatchId is a moderator override and must be respected.
  const current = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { currentMatchId: true, paused: true, state: true } });
  if (current?.currentMatchId === match.id && match.status === 'live' && !current.paused && current.state !== 'FINISHED') {
    const latest = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { matches: true },
    });
    const waitingMatches = latest?.matches
      .filter((m) => m.status === 'waiting' && m.aUnitId && m.bUnitId)
      .sort((a, b) => matchOrder(a) - matchOrder(b)) ?? [];
    const nextActive = waitingMatches.find((candidate) => matchOrder(candidate) > matchOrder(match)) ?? waitingMatches[0];
    if (nextActive) {
      await prisma.$transaction([
        prisma.match.update({ where: { id: nextActive.id }, data: { status: 'live' } }),
        prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: nextActive.id } }),
      ]);
      for (const unitId of [nextActive.aUnitId, nextActive.bUnitId]) {
        if (unitId) pingUnit(tournamentId, unitId, nextActive.id, 'match_activation');
      }
    } else {
      await prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: null } });
    }
  }

  await emit(tournamentId);
}

export async function undoLastResult(tournamentId: string): Promise<void> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { matches: { include: { result: true } } },
  });
  if (!t) throw new ServiceError('Tournament not found', 404);

  // Undo the most recently SAVED result (by result creation time), not bracket order.
  const finished = t.matches
    .filter((m) => m.status === 'finished' && m.result)
    .sort((x, y) =>
      new Date(y.result!.createdAt).getTime() - new Date(x.result!.createdAt).getTime(),
    );
  if (finished.length === 0) throw new ServiceError('Nothing to undo');
  const last = finished[0];

  await prisma.$transaction([
    prisma.matchResult.delete({ where: { matchId: last.id } }),
    prisma.match.update({ where: { id: last.id }, data: { status: 'waiting' } }),
  ]);

  // Pull the tournament state back if undo breaks stage completeness.
  const prelims = await prisma.match.findMany({ where: { tournamentId, stage: 'PRELIMINARY' } });
  const prelimsDone = prelims.every((m) => m.status === 'finished');
  if (!prelimsDone && t.state !== 'PRELIMINARY' && t.state !== 'SETUP') {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: null } });
    await prisma.match.deleteMany({ where: { tournamentId, stage: { in: ['SEMIFINALS', 'FINAL'] } } });
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'PRELIMINARY' } });
  } else if (last.stage === 'FINAL' && t.state === 'FINISHED') {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'FINAL' } });
  } else if (last.stage === 'SEMIFINALS' && t.state === 'FINAL') {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'SEMIFINALS' } });
  }

  await emit(tournamentId);
}

// ---------- stage advancement ----------

function slotRefJson(slot: { kind: string; standing?: number; groupId?: string; groupPosition?: number }): string {
  return JSON.stringify(slot);
}

async function advanceIfComplete(tournamentId: string): Promise<void> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { matches: true, groups: { include: { members: true } } },
  });
  if (!t || t.state === 'SETUP' || t.state === 'FINISHED') return;

  const allFinished = (stage: string) =>
    t.matches.filter((m) => m.stage === stage).every((m) => m.status === 'finished');

  if (t.state === 'PRELIMINARY') {
    const hasPrelims = t.matches.some((m) => m.stage === 'PRELIMINARY');
    if (!hasPrelims || !allFinished('PRELIMINARY')) return;
    await createKnockoutIfNeeded(t, 1);
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'SEMIFINALS' } });
    await emit(tournamentId);
    return;
  }

  if (t.state === 'SEMIFINALS') {
    if (!allFinished('SEMIFINALS')) return;
    await createKnockoutIfNeeded(t, 2);
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'FINAL' } });
    await emit(tournamentId);
    return;
  }

  if (t.state === 'FINAL') {
    if (!allFinished('FINAL')) return;
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'FINISHED' } });
    await emit(tournamentId);
  }
}

/** Resolve a slot against preliminary standings/groups. */
async function resolveSlotRef(
  slot: { kind: string; standing?: number; groupId?: string; groupPosition?: number },
  tournamentId: string,
  format: string,
  groups: { id: string; name: string; members: { unitId: string }[] }[],
): Promise<string | null> {
  const matches = await prisma.match.findMany({
    where: { tournamentId, stage: 'PRELIMINARY' },
    include: { result: true },
  });
  const finished = matches
    .filter((m) => m.status === 'finished' && m.result && m.aUnitId && m.bUnitId)
    .map((m) => ({
      aUnitId: m.aUnitId as string,
      bUnitId: m.bUnitId as string,
      winnerUnitId: m.result!.winnerUnitId,
      aDamageDealt: m.result!.aDamageDealt,
      bDamageDealt: m.result!.bDamageDealt,
    }));
  const units = await prisma.unit.findMany({ where: { tournamentId } });
  const unitIds = units.map((u) => u.id);
  if (slot.kind === 'standing') {
    const all = await standingsFromMatchesWithNames(unitIds, finished, tournamentId);
    return all[(slot.standing ?? 1) - 1]?.unitId ?? null;
  }
  const g = groups.find((gr) => gr.id === slot.groupId);
  if (!g) return null;
  const gFinished = finished.filter(
    (m) => g.members.some((mm) => mm.unitId === m.aUnitId) && g.members.some((mm) => mm.unitId === m.bUnitId),
  );
  const rows = await standingsFromMatchesWithNames(g.members.map((mm) => mm.unitId), gFinished, tournamentId);
  return rows[(slot.groupPosition ?? 1) - 1]?.unitId ?? null;
}

async function standingsFromMatchesWithNames(
  unitIds: string[],
  finished: { aUnitId: string; bUnitId: string; winnerUnitId: string; aDamageDealt: number; bDamageDealt: number }[],
  tournamentId: string,
) {
  const { standingsFromMatches } = await import('./state.js');
  const units = await prisma.unit.findMany({ where: { tournamentId, id: { in: unitIds } } });
  const meta = (uid: string) => {
    const u = units.find((x) => x.id === uid);
    return { name: u?.name ?? uid, country: u?.country ?? null, abbreviation: u?.abbreviation ?? null };
  };
  return standingsFromMatches(unitIds, finished, meta);
}

async function createKnockoutIfNeeded(
  t: {
    id: string;
    format: string;
    groups: { id: string; name: string; members: { unitId: string }[] }[];
  },
  nextStage: number,
): Promise<void> {
  if (nextStage !== 1 && nextStage !== 2) return;
  const existing = await prisma.match.findMany({
    where: { tournamentId: t.id, stage: nextStage === 1 ? 'SEMIFINALS' : 'FINAL' },
  });
  if (existing.length > 0) return;

  const createMatch = async (
    stage: Stage,
    round: number,
    aUnitId: string | null,
    bUnitId: string | null,
    slotA: { kind: string; standing?: number; groupId?: string; groupPosition?: number } | null,
    slotB: { kind: string; standing?: number; groupId?: string; groupPosition?: number } | null,
    sfIndex: number | null,
  ) => {
    await prisma.match.create({
      data: {
        id: id('m'),
        tournamentId: t.id,
        stage,
        round,
        orderInStage: round,
        label: stage === 'FINAL' ? 'Final' : `Semifinal ${round}`,
        aUnitId,
        bUnitId,
        slotA: slotA ? slotRefJson(slotA) : null,
        slotB: slotB ? slotRefJson(slotB) : null,
        status: aUnitId && bUnitId ? 'waiting' : 'waiting',
        sfIndex,
      },
    });
  };

  if (nextStage === 1) {
    const plan = knockoutPlanFor(t.format, t.groups);
    const a = await resolveSlotRef(plan.sf1.a, t.id, t.format, t.groups);
    const b = await resolveSlotRef(plan.sf1.b, t.id, t.format, t.groups);
    const c = await resolveSlotRef(plan.sf2.a, t.id, t.format, t.groups);
    const d = await resolveSlotRef(plan.sf2.b, t.id, t.format, t.groups);
    if (!a || !b || !c || !d) {
      throw new ServiceError('Cannot start knockout stage: required preliminary matches are unfinished');
    }
    await createMatch('SEMIFINALS', 1, a, b, plan.sf1.a, plan.sf1.b, 1);
    await createMatch('SEMIFINALS', 2, c, d, plan.sf2.a, plan.sf2.b, 2);
  } else {
    // Final created when both semifinals are done; winners resolved by advanceIfComplete->createKnockoutIfNeeded(2)
    const sfs = await prisma.match.findMany({ where: { tournamentId: t.id, stage: 'SEMIFINALS' }, include: { result: true } });
    const sf1 = sfs.find((m) => m.round === 1);
    const sf2 = sfs.find((m) => m.round === 2);
    const w1 = sf1?.result?.winnerUnitId ?? null;
    const w2 = sf2?.result?.winnerUnitId ?? null;
    if (!w1 || !w2) throw new ServiceError('Cannot create final: semifinal winners missing');
    await createMatch('FINAL', 1, w1, w2, null, null, null);
  }
}

// ---------- state control ----------

export async function setTournamentState(tournamentId: string, state: TournamentState): Promise<void> {
  const t = await prisma.tournament.findUnique({ include: { matches: true }, where: { id: tournamentId } });
  if (!t) throw new ServiceError('Tournament not found', 404);

  const cur = t.state;
  if (state === cur) return;

  if (state === 'PRELIMINARY' && cur === 'SETUP') {
    const prelims = t.matches.filter((m) => m.stage === 'PRELIMINARY');
    if (prelims.length === 0) throw new ServiceError('No preliminary matches generated');
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'PRELIMINARY' } });
  } else if (state === 'SEMIFINALS') {
    await advanceIfComplete(tournamentId);
    const after = await prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (after && after.state !== 'SEMIFINALS' && after.state !== 'FINAL' && after.state !== 'FINISHED') {
      throw new ServiceError('Cannot start knockout stage while preliminary matches are unfinished');
    }
  } else if (state === 'FINAL') {
    await advanceIfComplete(tournamentId);
  } else if (state === 'FINISHED') {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'FINISHED' } });
  } else {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state } });
  }

  await emit(tournamentId);
}

export async function resetTournament(tournamentId: string): Promise<void> {
  await prisma.$transaction([
    prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: null } }),
    prisma.matchResult.deleteMany({ where: { match: { tournamentId } } }),
    prisma.match.deleteMany({ where: { tournamentId } }),
  ]);
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { units: { include: { members: true } }, groups: { include: { members: true } } },
  });
  if (!t) throw new ServiceError('Tournament not found', 404);
  const size = t.participantCount;
  const info = formatInfo(size);
  const units = t.units.map((u) => ({
    id: u.id,
    kind: u.kind as 'player' | 'team',
    name: u.name,
    country: u.country,
    abbreviation: u.abbreviation,
    memberIds: u.members.map((m) => m.participantId),
  }));
  const groupRows = t.groups.map((g) => ({
    id: g.id,
    name: g.name,
    unitIds: g.members.map((m) => m.unitId),
  }));
  const schedule = buildSchedule(units, size, { groups: groupRows.length ? groupRows : undefined });
  await prisma.$transaction([
    prisma.match.createMany({
    data: schedule.matches.map((m, i) => ({
      id: id('m'),
      tournamentId,
      stage: m.stage,
      round: m.round,
      orderInStage: i + 1,
      label: `Match ${i + 1}`,
      aUnitId: m.aUnitId,
      bUnitId: m.bUnitId,
      status: 'waiting',
    })),
    }),
    prisma.tournament.update({
      where: { id: tournamentId },
      data: { state: 'SETUP', currentMatchId: null, seed: schedule.seed },
    }),
  ]);
  await emit(tournamentId);
}

export async function deleteTournament(tournamentId: string): Promise<void> {
  try {
    await prisma.tournament.delete({ where: { id: tournamentId } });
  } catch {
    throw new ServiceError('Tournament not found', 404);
  }
  broadcastAllSafe();
}

function broadcastAllSafe(): void {
  import('./db.js').then(({ broadcastAll }) => broadcastAll({ type: 'deleted', tournamentId: '*' }));
}

export async function deleteDemoTournaments(): Promise<number> { 
  const demos = await prisma.tournament.findMany({ where: { isDemo: true } });
  for (const d of demos) {
    await prisma.tournament.delete({ where: { id: d.id } });
  }
  broadcastAllSafe();
  return demos.length;
}

// ---------- current match ----------

export async function setPaused(tournamentId: string, paused: boolean): Promise<void> {
  const t = await prisma.tournament.findUnique({ include: { matches: true }, where: { id: tournamentId } });
  if (!t) throw new ServiceError('Tournament not found', 404);
  await prisma.tournament.update({ where: { id: tournamentId }, data: { paused } });
  if (paused) {
    for (const m of t.matches) {
      if (m.status === 'live') {
        await prisma.match.update({ where: { id: m.id }, data: { status: 'waiting' } });
      }
    }
  } else if (t.currentMatchId) {
    const currentMatch = t.matches.find((m) => m.id === t.currentMatchId);
    if (currentMatch && currentMatch.status !== 'finished') {
      await prisma.match.update({ where: { id: currentMatch.id }, data: { status: 'live' } });
      for (const unitId of [currentMatch.aUnitId, currentMatch.bUnitId]) {
        if (unitId) pingUnit(tournamentId, unitId, currentMatch.id, 'match_activation');
      }
    }
  }
  await emit(tournamentId);
}

export async function setCurrentMatch(tournamentId: string, matchId: string | null): Promise<void> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { matches: true } });
  if (!t) throw new ServiceError('Tournament not found', 404);
  const selected = matchId ? t.matches.find((m) => m.id === matchId) : null;
  if (matchId !== null && !selected) throw new ServiceError('Match not found', 404);
  if (selected?.status === 'finished') throw new ServiceError('A finished match cannot be set live');

  const activationChanged = Boolean(selected && (selected.status !== 'live' || t.currentMatchId !== selected.id));
  await prisma.$transaction(async (tx) => {
    for (const match of t.matches) {
      if (match.status === 'live' && match.id !== matchId) {
        await tx.match.update({ where: { id: match.id }, data: { status: 'waiting' } });
      }
    }
    if (selected && selected.status !== 'live') {
      await tx.match.update({ where: { id: selected.id }, data: { status: 'live' } });
    }
    await tx.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: matchId } });
  });
  if (selected && activationChanged) {
    for (const unitId of [selected.aUnitId, selected.bUnitId]) {
      if (unitId) pingUnit(tournamentId, unitId, selected.id, 'match_activation');
    }
  }
  await emit(tournamentId);
}

export async function sendManualPing(tournamentId: string, unitId: string): Promise<void> {
  const unit = await prisma.unit.findFirst({ where: { id: unitId, tournamentId }, select: { id: true } });
  if (!unit) throw new ServiceError('Player or team not found', 404);
  pingUnit(tournamentId, unitId, null, 'manual');
}

// ---------- overlay settings + override ----------

export async function updateOverlaySettings(
  tournamentId: string,
  patch: Partial<{
    autoRotation: boolean;
    rotationIntervalSec: number;
    showLogo: boolean;
    showTournamentName: boolean;
    showFlags: boolean;
    compact: boolean;
    transparent: boolean;
    theme: string;
  }>,
): Promise<void> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!t) throw new ServiceError('Tournament not found', 404);
  const data: Record<string, unknown> = {};
  if (typeof patch.autoRotation === 'boolean') data.autoRotation = patch.autoRotation;
  if (typeof patch.rotationIntervalSec === 'number' && patch.rotationIntervalSec >= 5 && patch.rotationIntervalSec <= 300) {
    data.rotationIntervalSec = Math.round(patch.rotationIntervalSec);
  }
  if (typeof patch.showLogo === 'boolean') data.showLogo = patch.showLogo;
  if (typeof patch.showTournamentName === 'boolean') data.showTournamentName = patch.showTournamentName;
  if (typeof patch.showFlags === 'boolean') data.showFlags = patch.showFlags;
  if (typeof patch.compact === 'boolean') data.compact = patch.compact;
  if (typeof patch.transparent === 'boolean') data.transparent = patch.transparent;
  if (patch.theme === 'dark' || patch.theme === 'light') data.theme = patch.theme;
  await prisma.tournamentSettings.upsert({
    where: { tournamentId },
    create: { tournamentId, ...data },
    update: data,
  });
  await emit(tournamentId);
}


export async function setOverlayMode(tournamentId: string, mode: OverlayOverrideDTO['mode']): Promise<void> {
  const allowed = ['auto', 'next_matches', 'table', 'bracket', 'current_match'];
  if (!allowed.includes(mode)) throw new ServiceError(`Invalid overlay mode: ${mode}`);
  await prisma.tournamentSettings.upsert({
    where: { tournamentId },
    create: { tournamentId, overlayMode: mode },
    update: { overlayMode: mode },
  });
  await emit(tournamentId);
}

// ---------- demo mode ----------

const DEMO_NAMES = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot',
  'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima',
];

export async function createDemoTournament(kind: 'full' | 'team' | 'groups'): Promise<string> {
  const sizes: Record<string, number> = { full: 7, team: 8, groups: 6 };
  const size = sizes[kind] ?? 7;
  const participants = DEMO_NAMES.slice(0, size).map((n) => ({ name: `Player ${n}` }));
  let teams: { name: string; memberIds: string[] }[] | null = null;
  if (size === 8) {
    const ids: string[] = [];
    // createTournament assigns ids; here we pre-assign for pairing
    const pre = participants.map((p, i) => ({ ...p, id: `p_demo_${i + 1}` }));
    for (let i = 0; i < size; i += 2) {
      ids.push(`${pre[i].id},${pre[i + 1].id}`);
    }
    teams = ids.map((pair, i) => ({ name: `Team ${i + 1}`, memberIds: pair.split(',') }));
    const tid = await createTournament({
      name: 'Demo Team Tournament (8)',
      participantCount: 8,
      participants: pre,
      teams,
      isDemo: true,
    });
    await fillDemoResults(tid);
    return tid;
  }
  const tid = await createTournament({
    name: kind === 'groups' ? 'Demo Group Tournament (6)' : 'Demo Tournament (7)',
    participantCount: size,
    participants,
    isDemo: true,
  });
  await fillDemoResults(tid);
  return tid;
}

async function fillDemoResults(tournamentId: string): Promise<void> {
  const { getTournamentState } = await import('./state.js');
  await setTournamentState(tournamentId, 'PRELIMINARY');
  // Simulate moderator entering all preliminary results, then knockouts.
  for (let guard = 0; guard < 100; guard++) {
    const state = await getTournamentState(tournamentId);
    if (state.state === 'FINISHED') break;
    const next = state.matches.find((m) => m.status === 'waiting' && m.aUnitId && m.bUnitId);
    if (!next) {
      // Try manual stage advance (e.g. semifinals complete but final not auto-created)
      try {
        await setTournamentState(tournamentId, 'FINAL');
      } catch {
        break;
      }
      continue;
    }
    const aDamage = 300 + Math.floor(Math.random() * 700);
    const bDamage = 300 + Math.floor(Math.random() * 700);
    const winnerUnitId = aDamage >= bDamage ? next.aUnitId! : next.bUnitId!;
    try {
      await saveResult(tournamentId, next.id, { winnerUnitId, aDamageDealt: aDamage, bDamageDealt: bDamage });
    } catch {
      break;
    }
  }
}

