// Prisma client + SSE client registry.

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

type SseClient = {
  id: number;
  tournamentId: string;
  write: (chunk: string) => void;
};

let nextClientId = 1;
const clients = new Map<number, SseClient>();

export function addClient(tournamentId: string, write: (chunk: string) => void): () => void {
  const client = { id: nextClientId++, tournamentId, write };
  clients.set(client.id, client);
  return () => {
    clients.delete(client.id);
  };
}

export function broadcast(tournamentId: string, payload: unknown): void {
  const eventType = typeof payload === 'object' && payload !== null && 'type' in payload
    ? String((payload as { type: unknown }).type)
    : null;
  const data = `${eventType ? `event: ${eventType}\n` : ''}data: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients.values()) {
    if (c.tournamentId !== tournamentId) continue;
    try {
      c.write(data);
      c.write(`: ping ${Date.now()}\n\n`);
    } catch {
      /* dropped */
    }
  }
}

export function broadcastAll(payload: unknown): void {
  const eventType = typeof payload === 'object' && payload !== null && 'type' in payload
    ? String((payload as { type: unknown }).type)
    : null;
  const data = `${eventType ? `event: ${eventType}\n` : ''}data: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients.values()) {
    try {
      c.write(data);
    } catch {
      /* dropped */
    }
  }
}
