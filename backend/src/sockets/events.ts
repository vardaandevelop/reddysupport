import type { Socket } from "socket.io";
import { z } from "zod";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/errors.js";
import { authorizeConversation } from "../services/access.service.js";
import {
  broadcastMessage,
  markMessagesRead,
  persistMessage,
  sendMessageSchema,
} from "../services/message.service.js";
import type { SocketIdentity } from "./auth.js";
import { ALL_QUEUES, addPresence, emitToRooms, removePresence, room, staffRooms } from "./registry.js";

type Ack = (response: unknown) => void;

/** Acknowledgement shape understood by both frontend and spec contracts. */
const ok = (data: Record<string, unknown> = {}) => ({ ok: true, success: true, data, ...data });
const fail = (code: string, message: string) => ({
  ok: false,
  success: false,
  code,
  message,
  error: { code, message },
});

const respond = (ack: Ack | undefined, payload: unknown) => {
  if (typeof ack === "function") ack(payload);
};

const asError = (error: unknown) =>
  error instanceof AppError
    ? fail(error.code, error.message)
    : error instanceof z.ZodError
      ? fail("VALIDATION_ERROR", "Invalid payload")
      : fail("SERVER_ERROR", "Unexpected realtime error");

const conversationPayload = z.object({ conversationId: z.string().uuid() });

/** Simple per-socket throttle so typing events cannot be used as a flood. */
function throttle(limit: number, windowMs: number) {
  let count = 0;
  let resetAt = Date.now() + windowMs;
  return () => {
    const now = Date.now();
    if (now > resetAt) { count = 0; resetAt = now + windowMs; }
    count += 1;
    return count <= limit;
  };
}

export function registerSocketEvents(socket: Socket) {
  const identity = socket.data.identity as SocketIdentity | undefined;
  if (!identity) { socket.disconnect(true); return; }
  const { actor } = identity;
  const joined = new Set<string>();
  const typingAllowed = throttle(30, 10_000);
  const sendAllowed = throttle(60, 10_000);

  if (actor.kind === "customer") {
    void socket.join(room.customer(actor.customerId));
    if (addPresence("customer", actor.customerId, socket.id)) {
      emitToRooms(staffRooms(), "customer:online", { customerId: actor.customerId });
    }
  } else {
    void socket.join(room.user(actor.userId));
    const queues = actor.role === "STAFF" ? actor.queues : [...ALL_QUEUES];
    for (const queue of queues) void socket.join(room.queue(queue));
    if (addPresence("management", actor.userId, socket.id)) {
      emitToRooms([...staffRooms(), room.user(actor.userId)], "staff:online", { staffId: actor.userId });
    }
  }

  socket.on("conversation:join", async (payload: unknown, ack?: Ack) => {
    try {
      const { conversationId } = conversationPayload.parse(payload);
      await authorizeConversation(actor, conversationId);
      await socket.join(room.conversation(conversationId));
      joined.add(conversationId);
      respond(ack, ok({ conversationId }));
    } catch (error) {
      respond(ack, asError(error));
    }
  });

  socket.on("conversation:leave", async (payload: unknown, ack?: Ack) => {
    try {
      const { conversationId } = conversationPayload.parse(payload);
      await socket.leave(room.conversation(conversationId));
      joined.delete(conversationId);
      respond(ack, ok({ conversationId }));
    } catch (error) {
      respond(ack, asError(error));
    }
  });

  socket.on("message:send", async (payload: unknown, ack?: Ack) => {
    try {
      if (!sendAllowed()) throw new AppError(429, "MESSAGE_SEND_FAILED", "Too many messages");
      const base = conversationPayload.parse(payload);
      const input = sendMessageSchema.parse(payload);
      const conversation = await authorizeConversation(actor, base.conversationId);
      const { message, deduplicated } = await persistMessage(actor, conversation, input);
      const dto = broadcastMessage(conversation, message);
      respond(ack, ok({ message: dto, messageId: dto.id, clientMessageId: dto.clientMessageId, deduplicated }));
    } catch (error) {
      respond(ack, asError(error));
    }
  });

  socket.on("message:read", async (payload: unknown, ack?: Ack) => {
    try {
      const input = conversationPayload
        .extend({ messageIds: z.array(z.string().uuid()).max(200).optional() })
        .parse(payload);
      const conversation = await authorizeConversation(actor, input.conversationId);
      const messageIds = await markMessagesRead(actor, conversation, input.messageIds);
      respond(ack, ok({ conversationId: conversation.id, messageIds }));
    } catch (error) {
      respond(ack, asError(error));
    }
  });

  for (const event of ["typing:start", "typing:stop"] as const) {
    socket.on(event, async (payload: unknown) => {
      try {
        if (!typingAllowed()) return;
        const { conversationId } = conversationPayload.parse(payload);
        if (!joined.has(conversationId)) await authorizeConversation(actor, conversationId);
        socket.to(room.conversation(conversationId)).emit(event, {
          conversationId,
          who: actor.kind === "customer" ? "CUSTOMER" : "STAFF",
        });
      } catch {
        /* typing indicators are best-effort */
      }
    });
  }

  socket.on("disconnect", () => {
    if (actor.kind === "customer") {
      if (removePresence("customer", actor.customerId, socket.id)) {
        emitToRooms(staffRooms(), "customer:offline", { customerId: actor.customerId });
        void prisma.customer
          .update({ where: { id: actor.customerId }, data: { lastSeenAt: new Date() } })
          .catch(() => undefined);
      }
    } else if (removePresence("management", actor.userId, socket.id)) {
      emitToRooms([...staffRooms(), room.user(actor.userId)], "staff:offline", { staffId: actor.userId });
    }
  });
}
