// API client + live state hook (SSE with polling fallback).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerViewDTO, TournamentStateDTO, TournamentSummaryDTO, ServerEvent, OverlaySettingsDTO, OverlayOverrideDTO, PresentationDeckDTO } from '@gt/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  return body as T;
}

export const api = {
  listTournaments: () => request<{ tournaments: TournamentSummaryDTO[] }>('/tournaments'),
  getTournament: (id: string) => request<TournamentStateDTO>(`/tournaments/${id}`),
  createTournament: (body: unknown) => request<{ id: string }>('/tournaments', { method: 'POST', body: JSON.stringify(body) }),
  setState: (id: string, state: string) => request(`/tournaments/${id}/state`, { method: 'POST', body: JSON.stringify({ state }) }),
  reset: (id: string) => request(`/tournaments/${id}/reset`, { method: 'POST' }),
  deleteTournament: (id: string) => request(`/tournaments/${id}`, { method: 'DELETE' }),
  setReadiness: (id: string, unitId: string, readiness: 'ready' | 'in_game') =>
    request(`/tournaments/${id}/units/${encodeURIComponent(unitId)}/readiness`, { method: 'POST', body: JSON.stringify({ readiness }) }),
  reportProblem: (id: string, unitId: string, message: string) =>
    request(`/tournaments/${id}/units/${encodeURIComponent(unitId)}/problem`, { method: 'POST', body: JSON.stringify({ message }) }),
  resolveProblem: (id: string, unitId: string) =>
    request(`/tournaments/${id}/units/${encodeURIComponent(unitId)}/problem/resolve`, { method: 'POST' }),
  uploadParticipantImage: (id: string, participantId: string, mimeType: string, dataBase64: string) =>
    request(`/tournaments/${id}/participants/${encodeURIComponent(participantId)}/image`, { method: 'POST', body: JSON.stringify({ mimeType, dataBase64 }) }),
  removeParticipantImage: (id: string, participantId: string) =>
    request(`/tournaments/${id}/participants/${encodeURIComponent(participantId)}/image`, { method: 'DELETE' }),
  setCurrentMatch: (id: string, matchId: string | null) =>
    request(`/tournaments/${id}/current-match`, { method: 'POST', body: JSON.stringify({ matchId }) }),
  pingUnit: (id: string, unitId: string) =>
    request(`/tournaments/${id}/units/${encodeURIComponent(unitId)}/ping`, { method: 'POST' }),
  saveResult: (id: string, matchId: string, body: { winnerUnitId: string; aDamageDealt: number; bDamageDealt: number }) =>
    request(`/tournaments/${id}/matches/${matchId}/result`, { method: 'POST', body: JSON.stringify(body) }),
  editResult: (id: string, matchId: string, body: { winnerUnitId: string; aDamageDealt: number; bDamageDealt: number }) =>
    request(`/tournaments/${id}/matches/${matchId}/result`, { method: 'PUT', body: JSON.stringify(body) }),
  undo: (id: string) => request(`/tournaments/${id}/undo`, { method: 'POST' }),
  getPlayer: (id: string, playerId: string) => request<PlayerViewDTO>(`/tournaments/${id}/player/${playerId}`),
  updateOverlaySettings: (id: string, patch: Partial<OverlaySettingsDTO>) =>
    request(`/tournaments/${id}/overlay-settings`, { method: 'PATCH', body: JSON.stringify(patch) }),
  setOverlayMode: (id: string, mode: OverlayOverrideDTO['mode']) =>
    request(`/tournaments/${id}/overlay-mode`, { method: 'POST', body: JSON.stringify({ mode }) }),
  updatePresentationDecks: (id: string, decks: PresentationDeckDTO[]) =>
    request(`/tournaments/${id}/presentation/decks`, { method: 'PUT', body: JSON.stringify({ decks }) }),
  selectPresentationDeck: (id: string, deckId: string) =>
    request(`/tournaments/${id}/presentation/deck`, { method: 'POST', body: JSON.stringify({ deckId }) }),
  setPresentationActive: (id: string, active: boolean) =>
    request(`/tournaments/${id}/presentation/active`, { method: 'POST', body: JSON.stringify({ active }) }),
  navigatePresentation: (id: string, direction: -1 | 1) =>
    request(`/tournaments/${id}/presentation/navigate`, { method: 'POST', body: JSON.stringify({ direction }) }),
  createDemo: (kind: 'full' | 'team' | 'groups') => request<{ id: string }>('/demo', { method: 'POST', body: JSON.stringify({ kind }) }),
  playerImageUrl: (imageUrl: string | null) => imageUrl ? `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(imageUrl)}` : null,
  deleteDemo: () => request<{ removed: number }>('/demo', { method: 'DELETE' }),
};

/**
 * Subscribes to live tournament state via SSE; falls back to polling if SSE fails.
 */
export function useTournamentState(id: string | null): {
  state: TournamentStateDTO | null;
  error: string | null;
  connected: boolean;
  lastPing: Extract<ServerEvent, { type: 'ping' }> | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<TournamentStateDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastPing, setLastPing] = useState<Extract<ServerEvent, { type: 'ping' }> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const s = await api.getTournament(id);
      setState(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let lastHeartbeat = Date.now();
    setLastPing(null);

    const startPolling = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => void refresh(), 3000);
    };
    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    void refresh();
    try {
      es = new EventSource(`/api/events?tournamentId=${encodeURIComponent(id)}`);
      es.onopen = () => {
        if (!cancelled) {
          lastHeartbeat = Date.now();
          setConnected(true);
          stopPolling();
        }
      };
      es.addEventListener('heartbeat', () => {
        lastHeartbeat = Date.now();
        if (!cancelled && es?.readyState === EventSource.OPEN) {
          setConnected(true);
          stopPolling();
        }
      });
      const receiveEvent = (event: Event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as ServerEvent;
          if (parsed.type === 'state' && parsed.tournamentId === id) {
            setState(parsed.state);
            setError(null);
          } else if (parsed.type === 'ping' && parsed.tournamentId === id) {
            setLastPing(parsed);
          } else if (parsed.type === 'deleted' && (parsed.tournamentId === id || parsed.tournamentId === '*')) {
            setState(null);
            setError('Dieses Turnier wurde gelöscht.');
          }
        } catch {
          /* ignore */
        }
      };
      es.addEventListener('state', receiveEvent);
      es.addEventListener('ping', receiveEvent);
      es.addEventListener('deleted', receiveEvent);
      watchdog = setInterval(() => {
        if (!cancelled && Date.now() - lastHeartbeat > 45000) {
          lastHeartbeat = Date.now();
          setConnected(false);
          startPolling();
        }
      }, 5000);
      es.onerror = () => {
        setConnected(false);
        startPolling();
      };

    } catch {
      startPolling();
    }

    return () => {
      cancelled = true;
      es?.close();
      if (watchdog) clearInterval(watchdog);
      stopPolling();
      setConnected(false);
    };
  }, [id, refresh]);

  return { state, error, connected, lastPing, refresh };
}

export function unitName(state: TournamentStateDTO, unitId: string | null): string {
  if (!unitId) return '—';
  return state.units.find((u) => u.id === unitId)?.name ?? unitId;
}
