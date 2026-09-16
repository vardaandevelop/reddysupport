import type { Server } from "socket.io";

/**
 * Realtime registry: holds the Socket.IO server instance so REST modules can
 * broadcast, plus in-memory presence tracking (multi-socket / multi-device).
 */

let io: Server | null = null;
export const setSocketServer = (server: Server) => { io = server; };
export const getSocketServer = () => io;

export const room = {
  conversation: (id: string) => `conversation:${id}`,
  customer: (id: string) => `customer:${id}`,
  user: (id: string) => `user:${id}`,
  queue: (queue: string) => `queue:${queue}`,
};

export const ALL_QUEUES = ["NEW_CLIENTS", "RECURRING_CLIENTS"] as const;

/** Emit to one or more rooms (Socket.IO de-duplicates overlapping rooms). */
export function emitToRooms(rooms: string[], event: string, payload: unknown) {
  if (!io || rooms.length === 0) return;
  let channel = io.to(rooms[0]!);
  for (const extra of rooms.slice(1)) channel = channel.to(extra);
  channel.emit(event, payload);
}

/** Everyone who must see conversation activity: participants + staff queues. */
export function conversationAudience(conversationId: string, customerId: string, clientType: string) {
  return [
    room.conversation(conversationId),
    room.customer(customerId),
    room.queue(clientType === "NEW" ? "NEW_CLIENTS" : "RECURRING_CLIENTS"),
  ];
}

export const staffRooms = () => ALL_QUEUES.map((queue) => room.queue(queue));

/* ------------------------------- presence -------------------------------- */

const presence = { customer: new Map<string, Set<string>>(), management: new Map<string, Set<string>>() };

/** Registers a socket; returns true when this identity just came online. */
export function addPresence(kind: "customer" | "management", id: string, socketId: string) {
  const map = presence[kind];
  const set = map.get(id) ?? new Set<string>();
  const first = set.size === 0;
  set.add(socketId);
  map.set(id, set);
  return first;
}

/** Removes a socket; returns true when this identity went fully offline. */
export function removePresence(kind: "customer" | "management", id: string, socketId: string) {
  const map = presence[kind];
  const set = map.get(id);
  if (!set) return false;
  set.delete(socketId);
  if (set.size > 0) return false;
  map.delete(id);
  return true;
}

export const isOnline = (kind: "customer" | "management", id: string) => presence[kind].has(id);
export const onlineIds = (kind: "customer" | "management") => [...presence[kind].keys()];
