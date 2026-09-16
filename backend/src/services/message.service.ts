import { z } from "zod";
import { prisma } from "../config/database.js";
import { messageDto } from "../modules/shared.js";
import { AppError } from "../utils/errors.js";
import { conversationAudience, emitToRooms, room } from "../sockets/registry.js";
import type { Actor, ConversationWithCustomer } from "./access.service.js";

export const sendMessageSchema = z
  .object({
    text: z.string().trim().max(10_000).optional(),
    messageType: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "AUDIO", "VOICE", "SYSTEM"]).default("TEXT"),
    clientMessageId: z.string().min(1).max(120),
    attachmentIds: z.array(z.string().uuid()).max(10).optional(),
    replyToMessageId: z.string().uuid().optional(),
  })
  .refine((value) => Boolean(value.text) || Boolean(value.attachmentIds?.length), {
    message: "Message content is required",
  });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

const senderOf = (actor: Actor) =>
  actor.kind === "customer"
    ? { senderType: "CUSTOMER" as const, senderId: actor.customerId }
    : { senderType: "STAFF" as const, senderId: actor.userId };

/**
 * Single source of truth for persisting a message — shared by the REST route
 * and the Socket.IO `message:send` handler. Idempotent on clientMessageId.
 */
export async function persistMessage(
  actor: Actor,
  conversation: ConversationWithCustomer,
  input: SendMessageInput,
) {
  const sender = senderOf(actor);
  if (actor.kind === "customer" && conversation.customer.status === "BLOCKED") {
    throw new AppError(403, "CUSTOMER_BLOCKED", "Customer is blocked");
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.message.findUnique({
      where: {
        conversationId_clientMessageId: {
          conversationId: conversation.id,
          clientMessageId: input.clientMessageId,
        },
      },
      include: { attachments: true },
    });
    if (existing) return { message: existing, deduplicated: true };

    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderType: sender.senderType,
        senderId: sender.senderId,
        messageType: input.messageType,
        text: input.text,
        clientMessageId: input.clientMessageId,
        replyToMessageId: input.replyToMessageId,
        deliveredAt: new Date(),
      },
      include: { attachments: true },
    });
    if (input.attachmentIds?.length) {
      await tx.attachment.updateMany({
        where: { id: { in: input.attachmentIds }, messageId: null },
        data: { messageId: message.id },
      });
    }
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt, status: "ACTIVE" },
    });
    if (actor.kind === "customer") {
      await tx.customer.update({ where: { id: actor.customerId }, data: { lastSeenAt: new Date() } });
    }
    const withAttachments = await tx.message.findUniqueOrThrow({
      where: { id: message.id },
      include: { attachments: true },
    });
    return { message: withAttachments, deduplicated: false };
  });
}

/** Broadcast an authoritative message to participants and the staff queue. */
export function broadcastMessage(conversation: ConversationWithCustomer, message: Parameters<typeof messageDto>[0]) {
  const dto = messageDto(message);
  emitToRooms(
    conversationAudience(conversation.id, conversation.customerId, conversation.customer.clientType),
    "message:new",
    { conversationId: conversation.id, message: dto },
  );
  emitToRooms([room.conversation(conversation.id)], "message:delivered", {
    conversationId: conversation.id,
    messageId: dto.id,
    clientMessageId: dto.clientMessageId,
  });
  return dto;
}

/**
 * Persist read receipts. Without explicit ids, marks every inbound message
 * (from the other party) in the conversation as read.
 */
export async function markMessagesRead(
  actor: Actor,
  conversation: ConversationWithCustomer,
  messageIds?: string[],
) {
  const otherSide = actor.kind === "customer" ? ["STAFF", "SYSTEM"] : ["CUSTOMER"];
  const targets = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      readAt: null,
      senderType: { in: otherSide as ("STAFF" | "SYSTEM" | "CUSTOMER")[] },
      ...(messageIds?.length ? { id: { in: messageIds } } : {}),
    },
    select: { id: true },
  });
  if (targets.length === 0) return [];
  const ids = targets.map((entry) => entry.id);
  await prisma.message.updateMany({ where: { id: { in: ids } }, data: { readAt: new Date() } });
  emitToRooms(
    conversationAudience(conversation.id, conversation.customerId, conversation.customer.clientType),
    "message:read",
    { conversationId: conversation.id, messageIds: ids },
  );
  return ids;
}
