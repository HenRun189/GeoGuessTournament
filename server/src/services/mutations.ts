// Write-side mutations: create, results, undo, state control, stage advancement, settings, demo.

import type { PresentationDeckDTO, TournamentState, OverlayOverrideDTO, Stage } from '@gt/shared';
import { DEFAULT_PRESENTATION_DECKS } from '@gt/shared';
import { buildSchedule, buildUnits, formatInfo } from '@gt/engine';
import { nanoid } from 'nanoid';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export async function updatePresentationDecks(tournamentId: string, decks: PresentationDeckDTO[]): Promise<void> {
  if (!Array.isArray(decks) || !decks.length || decks.length > 20) throw new ServiceError('Mindestens eine und höchstens 20 Präsentationen sind erforderlich');
  const normalized = decks.map((deck, index) => {
    const id = typeof deck?.id === 'string' ? deck.id.trim().slice(0, 80) : '';
    const title = typeof deck?.title === 'string' ? deck.title.trim() : '';
    if (!id || !title || title.length > 160 || !Array.isArray(deck.slides) || deck.slides.length > 30) throw new ServiceError(`Präsentation ${index + 1} ist ungültig`);
    const slides = deck.slides.map((slide, slideIndex) => {
      const slideId = typeof slide?.id === 'string' ? slide.id.trim().slice(0, 80) : '';
      const slideTitle = typeof slide?.title === 'string' ? slide.title.trim() : '';
      const text = typeof slide?.text === 'string' ? slide.text.trim() : '';
      const imageUrl = slide?.imageUrl == null ? null : typeof slide.imageUrl === 'string' ? slide.imageUrl.trim() : undefined;
      if (!slideId || !slideTitle || !text || slideTitle.length > 160 || text.length > 3000 || imageUrl === undefined || (imageUrl && imageUrl.length > 2048)) {
        throw new ServiceError(`Folie ${slideIndex + 1} in „${title}“ ist ungültig`);
      }
      return { id: slideId, title: slideTitle, text, imageUrl };
    });
    if (new Set(slides.map((slide) => slide.id)).size !== slides.length) throw new ServiceError(`Folien-IDs in „${title}“ müssen eindeutig sein`);
    return { id, title, slides };
  });
  if (new Set(normalized.map((deck) => deck.id)).size !== normalized.length) throw new ServiceError('Präsentations-IDs müssen eindeutig sein');
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { presentationActive: true, presentationIndex: true, presentationDeckId: true } });
  if (!tournament) throw new ServiceError('Tournament not found', 404);
  const deckExists = normalized.some((deck) => deck.id === tournament.presentationDeckId);
  const activeDeckId = deckExists ? tournament.presentationDeckId : normalized[0].id;
  const activeDeck = normalized.find((deck) => deck.id === activeDeckId)!;
  const currentSlideId = activeDeck.slides[tournament.presentationIndex]?.id;
  const index = currentSlideId ? Math.max(0, activeDeck.slides.findIndex((slide) => slide.id === currentSlideId)) : 0;
  await prisma.tournament.update({ where: { id: tournamentId }, data: { presentationSlides: JSON.stringify(normalized), presentationDeckId: activeDeckId, presentationIndex: index, presentationActive: tournament.presentationActive && activeDeck.slides.length > 0 } });
  await emit(tournamentId);
}

export async function selectPresentationDeck(tournamentId: string, deckId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { presentationSlides: true } });
  if (!tournament) throw new ServiceError('Tournament not found', 404);
  const deck = parsePresentationDecks(tournament.presentationSlides).find((item) => item.id === deckId);
  if (!deck) throw new ServiceError('Präsentation nicht gefunden', 404);
  await prisma.tournament.update({ where: { id: tournamentId }, data: { presentationDeckId: deckId, presentationIndex: 0, presentationActive: false } });
  await emit(tournamentId);
}

export async function navigatePresentation(tournamentId: string, delta: -1 | 1): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { presentationActive: true, presentationIndex: true, presentationSlides: true, presentationDeckId: true } });
  if (!tournament) throw new ServiceError('Tournament not found', 404);
  if (!tournament.presentationActive) throw new ServiceError('Die Präsentation ist nicht aktiv');
  const deck = parsePresentationDecks(tournament.presentationSlides).find((item) => item.id === tournament.presentationDeckId);
  if (!deck?.slides.length) throw new ServiceError('Die gewählte Präsentation hat keine Folien');
  const index = Math.max(0, Math.min(deck.slides.length - 1, tournament.presentationIndex + delta));
  await prisma.tournament.update({ where: { id: tournamentId }, data: { presentationIndex: index } });
  await emit(tournamentId);
}

export async function setPresentationActive(tournamentId: string, active: boolean): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { presentationSlides: true, presentationDeckId: true } });
  if (!tournament) throw new ServiceError('Tournament not found', 404);
  const deck = parsePresentationDecks(tournament.presentationSlides).find((item) => item.id === tournament.presentationDeckId);
  if (active && !deck?.slides.length) throw new ServiceError('Bitte erst mindestens eine Präsentationsfolie anlegen');
  const deckId = tournament.presentationDeckId;
  if (active) await prisma.tournament.update({ where: { id: tournamentId }, data: { presentationActive: false } });
  await prisma.tournament.update({ where: { id: tournamentId }, data: { presentationDeckId: deckId, presentationActive: active, presentationIndex: 0 } });
  await emit(tournamentId);
}

function parsePresentationDecks(serialized: string): PresentationDeckDTO[] {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter((deck): deck is PresentationDeckDTO => Boolean(deck && typeof deck === 'object' && typeof deck.id === 'string' && typeof deck.title === 'string' && Array.isArray(deck.slides))) : [];
  } catch { return []; }
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
    ...[match.aUnitId, match.bUnitId].filter((unitId): unitId is string => Boolean(unitId)).map((unitId) =>
      prisma.unit.update({ where: { id: unitId }, data: { readiness: 'waiting', readinessMatchId: null } }),
    ),
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
        if (unitId) {
          await prisma.unit.update({ where: { id: unitId }, data: { readiness: 'waiting', readinessMatchId: nextActive.id } });
          pingUnit(tournamentId, unitId, nextActive.id, 'match_activation');
        }
      }
    } else {
      await prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: null } });
    }
  }

  await emit(tournamentId);
  await startResultScreen(tournamentId, match.id);
}

export async function editResult(
  tournamentId: string,
  matchId: string,
  input: { winnerUnitId: string; aDamageDealt: number; bDamageDealt: number },
): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { matches: true } });
  if (!tournament) throw new ServiceError('Tournament not found', 404);
  const match = tournament.matches.find((candidate) => candidate.id === matchId);
  if (!match || match.status !== 'finished') throw new ServiceError('Completed match not found', 404);
  validateResult(match, input);
  if (tournament.paused) throw new ServiceError('Tournament is paused — resume it to edit results');

  if (match.stage === 'PRELIMINARY') {
    const current = tournament.matches.find((candidate) => candidate.id === tournament.currentMatchId);
    if (current && current.stage !== 'PRELIMINARY') {
      await prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: null } });
    }
    await prisma.match.deleteMany({ where: { tournamentId, stage: { in: ['SEMIFINALS', 'FINAL'] } } });
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { state: 'PRELIMINARY', currentMatchId: current?.stage === 'PRELIMINARY' && current.status === 'live' ? current.id : null },
    });
  } else if (match.stage === 'SEMIFINALS') {
    const currentMatch = tournament.matches.find((candidate) => candidate.id === tournament.currentMatchId);
    if (currentMatch?.stage === 'SEMIFINALS') {
      await prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: null } });
      await prisma.match.updateMany({ where: { tournamentId, stage: 'SEMIFINALS', status: 'live' }, data: { status: 'waiting' } });
    }
    const final = tournament.matches.find((candidate) => candidate.stage === 'FINAL');
    if (final) {
      if (tournament.currentMatchId === final.id) {
        await prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: null } });
      }
      await prisma.match.delete({ where: { id: final.id } });
    }
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'SEMIFINALS' } });
  } else if (match.stage === 'FINAL' && tournament.state !== 'FINAL' && tournament.state !== 'FINISHED') {
    throw new ServiceError('Tournament state does not allow editing the final');
  }

  await prisma.matchResult.upsert({
    where: { matchId },
    create: { matchId, ...input },
    update: { ...input, createdAt: new Date() },
  });
  await prisma.match.update({ where: { id: matchId }, data: { status: 'finished' } });
  await prisma.unit.updateMany({ where: { tournamentId, readinessMatchId: matchId }, data: { readiness: 'waiting', readinessMatchId: null } });
  if (match.stage === 'PRELIMINARY') {
    await advanceIfComplete(tournamentId);
  } else if (match.stage === 'SEMIFINALS') {
    await advanceIfComplete(tournamentId);
  } else if (match.stage === 'FINAL' && tournament.state === 'FINISHED') {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'FINISHED' } });
  } else if (match.stage === 'FINAL') {
    await advanceIfComplete(tournamentId);
  }
  await emit(tournamentId);
  await startResultScreen(tournamentId, match.id);
}

async function startResultScreen(tournamentId: string, matchId: string): Promise<void> {
  await prisma.tournament.update({ where: { id: tournamentId }, data: { resultScreenMatchId: matchId, resultScreenUntil: new Date(Date.now() + 12000) } });
  await emit(tournamentId);
}

function validateResult(
  match: { aUnitId: string | null; bUnitId: string | null },
  input: { winnerUnitId: string; aDamageDealt: number; bDamageDealt: number },
): void {
  if (!match.aUnitId || !match.bUnitId) throw new ServiceError('Match has no confirmed teams');
  if (input.winnerUnitId !== match.aUnitId && input.winnerUnitId !== match.bUnitId) {
    throw new ServiceError('Winner must be one of the two teams in the match');
  }
  for (const [label, value] of [['Team A', input.aDamageDealt], ['Team B', input.bDamageDealt]] as const) {
    if (!Number.isInteger(value) || value < 0) throw new ServiceError(`${label} damage must be a whole number ≥ 0`);
  }
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
    prisma.tournament.update({ where: { id: tournamentId }, data: { resultScreenMatchId: null, resultScreenUntil: null } }),
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
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'FINISHED', currentMatchId: null } });
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
    await prisma.unit.updateMany({ where: { tournamentId }, data: { readiness: 'waiting', readinessMatchId: null } });
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'PRELIMINARY', presentationActive: false } });
  } else if (state === 'SEMIFINALS') {
    await advanceIfComplete(tournamentId);
    const after = await prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (after && after.state !== 'SEMIFINALS' && after.state !== 'FINAL' && after.state !== 'FINISHED') {
      throw new ServiceError('Cannot start knockout stage while preliminary matches are unfinished');
    }
  } else if (state === 'FINAL') {
    await advanceIfComplete(tournamentId);
  } else if (state === 'FINISHED') {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'FINISHED', currentMatchId: null } });
  } else {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state } });
  }

  await emit(tournamentId);
}

export async function resetTournament(tournamentId: string): Promise<void> {
  await prisma.unit.updateMany({ where: { tournamentId }, data: { readiness: 'waiting', readinessMatchId: null, problemMessage: null, problemCreatedAt: null, problemResolved: false, problemWithdrawalTokenHash: null } });
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
    prisma.tournament.update({      where: { id: tournamentId },
      data: { state: 'SETUP', currentMatchId: null, seed: schedule.seed, presentationActive: false, resultScreenMatchId: null, resultScreenUntil: null },
    }),
  ]);
  await emit(tournamentId);
}

export async function deleteTournament(tournamentId: string): Promise<void> {
  const [images, tournament] = await Promise.all([
    prisma.participant.findMany({ where: { tournamentId }, select: { imagePath: true } }),
    prisma.tournament.findUnique({ where: { id: tournamentId }, select: { presentationVideoPath: true } }),
  ]);
  try {
    // Break the optional current-match reference before cascading into matches.
    await prisma.tournament.update({ where: { id: tournamentId }, data: { currentMatchId: null } });
    await prisma.tournament.delete({ where: { id: tournamentId } });
  } catch {
    throw new ServiceError('Tournament not found', 404);
  }
  await Promise.all([
    ...images.map((participant) => removeStoredImage(participant.imagePath)),
    removeStoredVideo(tournament?.presentationVideoPath ?? null),
  ]);
  broadcastAllSafe();
}

function broadcastAllSafe(): void {
  import('./db.js').then(({ broadcastAll }) => broadcastAll({ type: 'deleted', tournamentId: '*' }));
}

export async function deleteDemoTournaments(): Promise<number> {
  const demos = await prisma.tournament.findMany({ where: { isDemo: true }, select: { id: true } });
  for (const demo of demos) await deleteTournament(demo.id);
  return demos.length;
}

// ---------- current match ----------

export async function setPaused(tournamentId: string, paused: boolean): Promise<void> {
  const t = await prisma.tournament.findUnique({ include: { matches: true }, where: { id: tournamentId } });
  if (!t) throw new ServiceError('Tournament not found', 404);
  await prisma.tournament.update({ where: { id: tournamentId }, data: { paused } });
  if (paused) {
    for (const m of t.matches) {
      if (m.status === 'live') await prisma.match.update({ where: { id: m.id }, data: { status: 'waiting' } });
    }
    await prisma.unit.updateMany({ where: { tournamentId, readinessMatchId: t.currentMatchId }, data: { readiness: 'waiting', readinessMatchId: null } });
  } else if (t.currentMatchId) {
    const currentMatch = t.matches.find((m) => m.id === t.currentMatchId);
    if (currentMatch && currentMatch.status !== 'finished') {
      await prisma.match.update({ where: { id: currentMatch.id }, data: { status: 'live' } });
      for (const unitId of [currentMatch.aUnitId, currentMatch.bUnitId]) {
        if (unitId) {
          await prisma.unit.update({ where: { id: unitId }, data: { readiness: 'waiting', readinessMatchId: currentMatch.id } });
          pingUnit(tournamentId, unitId, currentMatch.id, 'match_activation');
        }
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
  if (selected && (t.state === 'SETUP' || t.state === 'FINISHED')) throw new ServiceError('In diesem Turnierstadium kann kein Match aktiviert werden');
  if (selected && t.paused) throw new ServiceError('Das Turnier ist pausiert');
  if (selected && (!selected.aUnitId || !selected.bUnitId)) throw new ServiceError('Dieses Match hat noch keine bestätigten Teilnehmenden');
  const previousLive = t.matches.filter((match) => match.status === 'live' && match.id !== matchId);
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
  const newlyActiveUnitIds = new Set([selected?.aUnitId, selected?.bUnitId].filter((unitId): unitId is string => Boolean(unitId)));
  for (const previous of previousLive) {
    for (const unitId of [previous.aUnitId, previous.bUnitId]) {
      if (unitId && !newlyActiveUnitIds.has(unitId)) {
        await prisma.unit.update({ where: { id: unitId }, data: { readiness: 'waiting', readinessMatchId: null } });
      }
    }
  }
  if (selected && activationChanged) {
    for (const unitId of [selected.aUnitId, selected.bUnitId]) {
      if (unitId) {
        await prisma.unit.update({ where: { id: unitId }, data: { readiness: 'waiting', readinessMatchId: selected.id } });
        pingUnit(tournamentId, unitId, selected.id, 'match_activation');
      }
    }
  }
  await emit(tournamentId);
}

export async function setReadiness(tournamentId: string, unitId: string, readiness: 'waiting' | 'ready' | 'in_game'): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, include: { matches: true } });
  if (!tournament) throw new ServiceError('Tournament not found', 404);
  const unit = await prisma.unit.findFirst({ where: { id: unitId, tournamentId } });
  if (!unit) throw new ServiceError('Player or team not found', 404);
  const ownOpenMatches = tournament.matches
    .filter((match) => match.status !== 'finished' && (match.aUnitId === unitId || match.bUnitId === unitId));
  const upcoming = ownOpenMatches.find((match) => match.status === 'live') ?? ownOpenMatches.sort((a, b) => matchOrder(a) - matchOrder(b))[0];
  if (!upcoming) throw new ServiceError('Es ist kein eigenes Spiel mehr offen');
  await prisma.unit.update({
    where: { id: unitId },
    data: { readiness, readinessMatchId: readiness === 'waiting' ? null : upcoming.id },
  });
  await emit(tournamentId);
}

export async function reportProblem(tournamentId: string, unitId: string, message: string): Promise<{ withdrawalToken: string }> {
  const text = message.trim();
  if (!text || text.length > 300) throw new ServiceError('Bitte eine Problembeschreibung mit höchstens 300 Zeichen eingeben');
  const unit = await prisma.unit.findFirst({ where: { id: unitId, tournamentId }, select: { id: true } });
  if (!unit) throw new ServiceError('Player or team not found', 404);
  const withdrawalToken = randomBytes(32).toString('hex');
  const problemWithdrawalTokenHash = createHash('sha256').update(withdrawalToken).digest('hex');
  await prisma.unit.update({
    where: { id: unitId },
    data: { problemMessage: text, problemCreatedAt: new Date(), problemResolved: false, problemWithdrawalTokenHash },
  });
  await emit(tournamentId);
  return { withdrawalToken };
}

export async function withdrawProblem(tournamentId: string, unitId: string, withdrawalToken: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(withdrawalToken)) throw new ServiceError('Berechtigung zum Zurücknehmen fehlt', 403);
  const tokenHash = createHash('sha256').update(withdrawalToken).digest('hex');
  const unit = await prisma.unit.findFirst({ where: { id: unitId, tournamentId }, select: { id: true, problemResolved: true, problemMessage: true, problemWithdrawalTokenHash: true } });
  if (!unit?.problemMessage || unit.problemResolved) throw new ServiceError('Nur offene Problemmeldungen können zurückgenommen werden', 409);
  const expected = unit.problemWithdrawalTokenHash;
  if (!expected || expected.length !== tokenHash.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(tokenHash))) throw new ServiceError('Berechtigung zum Zurücknehmen ungültig', 403);
  await prisma.unit.update({ where: { id: unitId }, data: { problemMessage: null, problemCreatedAt: null, problemResolved: false, problemWithdrawalTokenHash: null } });
  await emit(tournamentId);
}

export async function resolveProblem(tournamentId: string, unitId: string): Promise<void> {
  const unit = await prisma.unit.findFirst({ where: { id: unitId, tournamentId, problemMessage: { not: null } } });
  if (!unit) throw new ServiceError('Offene Problemmeldung nicht gefunden', 404);
  await prisma.unit.update({ where: { id: unitId }, data: { problemResolved: true, problemWithdrawalTokenHash: null } });
  await emit(tournamentId);
}

const uploadRoot = fileURLToPath(new URL('../../../server/uploads/', import.meta.url));
const maxImageBytes = 4 * 1024 * 1024;
const maxPresentationVideoBytes = 100 * 1024 * 1024;

function imageExtension(bytes: Buffer, mimeType: string): string | null {
  if (mimeType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (mimeType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function removeStoredVideo(videoPath: string | null): Promise<void> {
  if (!videoPath || basename(videoPath) !== videoPath || !/^presentation_[a-zA-Z0-9_-]+\.mp4$/.test(videoPath)) return;
  await unlink(join(uploadRoot, videoPath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function removeStoredImage(imagePath: string | null): Promise<void> {
  if (!imagePath || basename(imagePath) !== imagePath || !/^profile_[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(imagePath)) return;
  await unlink(join(uploadRoot, imagePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function uploadParticipantImage(
  tournamentId: string,
  participantId: string,
  input: { mimeType: string; dataBase64: string },
): Promise<void> {
  const participant = await prisma.participant.findFirst({ where: { id: participantId, tournamentId } });
  if (!participant) throw new ServiceError('Spieler nicht gefunden', 404);
  if (!input || typeof input.mimeType !== 'string' || typeof input.dataBase64 !== 'string') {
    throw new ServiceError('Bilddaten fehlen oder sind ungültig');
  }
  const encoded = input.dataBase64.replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > maxImageBytes || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new ServiceError('Bild muss kleiner als 4 MB und gültig sein');
  }
  const extension = imageExtension(bytes, input.mimeType);
  if (!extension) throw new ServiceError('Nur echte PNG-, JPEG- oder WebP-Bilder sind erlaubt');
  await mkdir(uploadRoot, { recursive: true });
  const newPath = `profile_${nanoid(18)}.${extension}`;
  await writeFile(join(uploadRoot, newPath), bytes, { flag: 'wx' });
  try {
    await prisma.participant.update({ where: { id: participantId }, data: { imagePath: newPath } });
  } catch (error) {
    await removeStoredImage(newPath);
    throw error;
  }
  await removeStoredImage(participant.imagePath);
  await emit(tournamentId);
}

export async function uploadPresentationVideo(tournamentId: string, bytes: Buffer): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { presentationVideoPath: true } });
  if (!tournament) throw new ServiceError('Tournament not found', 404);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxPresentationVideoBytes) {
    throw new ServiceError('Das MP4-Video muss kleiner als 100 MB sein');
  }
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') {
    throw new ServiceError('Die Datei ist kein gültiges MP4-Video');
  }
  await mkdir(uploadRoot, { recursive: true });
  const videoPath = `presentation_${nanoid(18)}.mp4`;
  await writeFile(join(uploadRoot, videoPath), bytes, { flag: 'wx' });
  try {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { presentationVideoPath: videoPath, presentationVideoActive: false } });
  } catch (error) {
    await removeStoredVideo(videoPath);
    throw error;
  }
  await removeStoredVideo(tournament.presentationVideoPath);
  await emit(tournamentId);
}

export async function setPresentationVideoActive(tournamentId: string, active: boolean): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { presentationVideoPath: true } });
  if (!tournament) throw new ServiceError('Tournament not found', 404);
  if (active && !tournament.presentationVideoPath) throw new ServiceError('Bitte zuerst ein MP4-Video auswählen');
  await prisma.tournament.update({ where: { id: tournamentId }, data: { presentationVideoActive: active } });
  await emit(tournamentId);
}

export async function removeParticipantImage(tournamentId: string, participantId: string): Promise<void> {
  const participant = await prisma.participant.findFirst({ where: { id: participantId, tournamentId } });
  if (!participant) throw new ServiceError('Spieler nicht gefunden', 404);
  await prisma.participant.update({ where: { id: participantId }, data: { imagePath: null } });
  await removeStoredImage(participant.imagePath);
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
    rotationViews: string[];
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
  } else if (patch.rotationIntervalSec !== undefined) {
    throw new ServiceError('Das Wechselintervall muss zwischen 5 und 300 Sekunden liegen');
  }
  if (typeof patch.showLogo === 'boolean') data.showLogo = patch.showLogo;
  if (typeof patch.showTournamentName === 'boolean') data.showTournamentName = patch.showTournamentName;
  if (typeof patch.showFlags === 'boolean') data.showFlags = patch.showFlags;
  if (typeof patch.compact === 'boolean') data.compact = patch.compact;
  if (typeof patch.transparent === 'boolean') data.transparent = patch.transparent;
  if (patch.theme === 'dark' || patch.theme === 'light') data.theme = patch.theme;
  if (Array.isArray(patch.rotationViews)) {
    const allowedViews = ['next_matches', 'all_matches', 'table', 'bracket', 'current_match', 'presentation'];
    const views = [...new Set(patch.rotationViews.filter((view) => allowedViews.includes(view)))];
    if (views.length === 0) throw new ServiceError('Mindestens eine Overlay-Ansicht für die Rotation wählen');
    data.rotationViews = JSON.stringify(views);
  }
  await prisma.tournamentSettings.upsert({
    where: { tournamentId },
    create: { tournamentId, ...data },
    update: data,
  });
  await emit(tournamentId);
}


export async function setOverlayMode(tournamentId: string, mode: OverlayOverrideDTO['mode']): Promise<void> {
  const allowed = ['auto', 'next_matches', 'all_matches', 'table', 'bracket', 'current_match', 'result_screen', 'presentation'];
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

