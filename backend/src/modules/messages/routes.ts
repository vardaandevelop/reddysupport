import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { findCustomerSession, findManagementSession } from "../../services/session.service.js";
import { effectivePermissions } from "../../middleware/require-management-auth.js";
import { AppError } from "../../utils/errors.js";
import { messageLimit } from "../../middleware/rate-limit.js";
import { messageDto } from "../shared.js";
import type { Actor } from "../../services/access.service.js";
import { authorizeConversation } from "../../services/access.service.js";
import {
  broadcastMessage,
  markMessagesRead,
  persistMessage,
  sendMessageSchema,
} from "../../services/message.service.js";

const router = Router({ mergeParams: true });
const conversationId = (req: Request) =>
  z.string().uuid().parse((req.params as Record<string, string | undefined>).id);

/** Derives the acting identity from session cookies only. */
async function resolveActor(req: Request): Promise<Actor> {
  const customerSession = await findCustomerSession(req);
  if (customerSession) return { kind: "customer", customerId: customerSession.customerId };
  const managementSession = await findManagementSession(req);
  if (!managementSession) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  const permissions = await effectivePermissions(managementSession.user);
  return {
    kind: "management",
    userId: managementSession.userId,
    name: managementSession.user.name,
    role: managementSession.user.role,
    queues: managementSession.user.queueAccess.map((entry) => entry.queue),
    permissions,
  };
}

router.get("/", async (req, res, next) => {
  try {
    const id = conversationId(req);
    const actor = await resolveActor(req);
    await authorizeConversation(actor, id);
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    let beforeDate: Date | undefined;
    if (req.query.before) {
      const anchor = await prisma.message.findFirst({ where: { id: String(req.query.before) } });
      beforeDate = anchor?.createdAt;
    }
    const rows = await prisma.message.findMany({
      where: { conversationId: id, ...(beforeDate && { createdAt: { lt: beforeDate } }) },
      include: { attachments: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json(rows.reverse().map(messageDto));
  } catch (error) {
    next(error);
  }
});

router.post("/", messageLimit, async (req, res, next) => {
  try {
    const id = conversationId(req);
    const input = sendMessageSchema.parse(req.body);
    const actor = await resolveActor(req);
    const conversation = await authorizeConversation(actor, id);
    const { message, deduplicated } = await persistMessage(actor, conversation, input);
    const dto = broadcastMessage(conversation, message);
    res.status(deduplicated ? 200 : 201).json(dto);
  } catch (error) {
    next(error);
  }
});

router.post("/read", async (req, res, next) => {
  try {
    const id = conversationId(req);
    const input = z.object({ messageIds: z.array(z.string().uuid()).max(200).optional() }).parse(req.body ?? {});
    const actor = await resolveActor(req);
    const conversation = await authorizeConversation(actor, id);
    await markMessagesRead(actor, conversation, input.messageIds);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
