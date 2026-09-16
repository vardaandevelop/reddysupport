import type { Socket } from "socket.io";
import { parse } from "cookie";
import { env } from "../config/env.js";
import { prisma } from "../config/database.js";
import { hashToken } from "../utils/tokens.js";
import { effectivePermissions } from "../middleware/require-management-auth.js";
import type { Actor } from "../services/access.service.js";

export type SocketIdentity = { actor: Actor; sessionId: string };

/**
 * Socket handshake authentication. Identity comes only from the same secure
 * HttpOnly session cookies REST uses — never from client-supplied payloads.
 */
export async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const cookies = parse(socket.handshake.headers.cookie ?? "");
    const managementToken = cookies[env.MANAGEMENT_COOKIE_NAME];
    const customerToken = cookies[env.CUSTOMER_COOKIE_NAME];

    if (managementToken) {
      const session = await prisma.managementSession.findFirst({
        where: {
          tokenHash: hashToken(managementToken),
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { active: true },
        },
        include: { user: { include: { queueAccess: true, permissions: { include: { permission: true } } } } },
      });
      if (session) {
        const permissions = await effectivePermissions(session.user);
        const identity: SocketIdentity = {
          sessionId: session.id,
          actor: {
            kind: "management",
            userId: session.userId,
            name: session.user.name,
            role: session.user.role,
            queues: session.user.queueAccess.map((entry) => entry.queue),
            permissions,
          },
        };
        socket.data.identity = identity;
        return next();
      }
    }

    if (customerToken) {
      const session = await prisma.customerSession.findFirst({
        where: { tokenHash: hashToken(customerToken), revokedAt: null, expiresAt: { gt: new Date() } },
        include: { customer: true },
      });
      if (session && session.customer.status !== "BLOCKED") {
        const identity: SocketIdentity = {
          sessionId: session.id,
          actor: { kind: "customer", customerId: session.customerId },
        };
        socket.data.identity = identity;
        return next();
      }
    }

    next(new Error("Unauthorized"));
  } catch {
    next(new Error("Unauthorized"));
  }
}
