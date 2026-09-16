import type { Conversation, Customer } from "@prisma/client";
import { prisma } from "../config/database.js";
import { AppError } from "../utils/errors.js";

/**
 * Server-side identity for both REST and Socket.IO. Never built from
 * client-supplied ids — always derived from a validated session.
 */
export type Actor =
  | { kind: "customer"; customerId: string }
  | { kind: "management"; userId: string; name?: string; role: string; queues: string[]; permissions: string[] };

export type ConversationWithCustomer = Conversation & { customer: Customer };

export const queueOf = (clientType: string) => (clientType === "NEW" ? "NEW_CLIENTS" : "RECURRING_CLIENTS");

export function hasPermission(actor: Extract<Actor, { kind: "management" }>, key: string) {
  return actor.role === "SUPER_ADMIN" || actor.permissions.includes(key);
}

/** Assignment, queue access, explicit permission or Super Admin. */
export function managementCanAccess(
  actor: Extract<Actor, { kind: "management" }>,
  conversation: ConversationWithCustomer,
) {
  if (actor.role !== "STAFF") return true;
  if (actor.permissions.includes("conversations.view_all")) return true;
  if (conversation.assignedStaffId === actor.userId) return true;
  return actor.queues.includes(queueOf(conversation.customer.clientType)) && !conversation.assignedStaffId;
}

export async function loadConversation(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { customer: true },
  });
  if (!conversation) throw new AppError(404, "CUSTOMER_NOT_FOUND", "Conversation not found");
  return conversation;
}

/** Throws unless the actor may read/write this conversation. */
export async function authorizeConversation(actor: Actor, conversationId: string) {
  const conversation = await loadConversation(conversationId);
  if (actor.kind === "customer") {
    if (conversation.customerId !== actor.customerId) {
      throw new AppError(403, "FORBIDDEN", "Conversation access denied");
    }
    if (conversation.customer.status === "BLOCKED") {
      throw new AppError(403, "CUSTOMER_BLOCKED", "Customer is blocked");
    }
  } else if (!managementCanAccess(actor, conversation)) {
    throw new AppError(403, "FORBIDDEN", "Conversation access denied");
  }
  return conversation;
}
