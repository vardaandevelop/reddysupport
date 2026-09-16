import type { AuditActorType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../config/database.js";
type Db = PrismaClient | Prisma.TransactionClient;
export const writeAudit = (input:{ actorId?:string|null; actorName?:string|null; actorType:AuditActorType; action:string; targetType?:string; targetId?:string; ipAddress?:string|null; userAgent?:string|null; metadata?:Prisma.InputJsonValue }, db:Db=prisma) => db.auditLog.create({ data:{...input, actorId:input.actorId ?? null, actorName:input.actorName ?? null, ipAddress:input.ipAddress ?? null, userAgent:input.userAgent ?? null} });
