import type { NextFunction, Request, Response } from "express";
import { findManagementSession } from "../services/session.service.js";
import { AppError } from "../utils/errors.js";
import { prisma } from "../config/database.js";
export async function effectivePermissions(user:{id:string;role:string;permissions:{granted:boolean;permission:{key:string}}[]}) {
  if(user.role === "SUPER_ADMIN") return (await prisma.permission.findMany({select:{key:true}})).map((p)=>p.key);
  const role=await prisma.rolePermission.findMany({where:{role:user.role as "ADMIN"|"STAFF"},include:{permission:true}});
  const grants=new Map(role.map((entry)=>[entry.permission.key,true]));
  for(const entry of user.permissions) grants.set(entry.permission.key,entry.granted);
  return [...grants].filter(([,granted])=>granted).map(([key])=>key);
}
export async function requireManagementAuth(req:Request,_res:Response,next:NextFunction){ try { const session=await findManagementSession(req); if(!session) throw new AppError(401,"UNAUTHORIZED","Authentication required"); const permissions=await effectivePermissions(session.user); req.management={user:session.user,permissions,queues:session.user.queueAccess.map((q)=>q.queue),sessionId:session.id}; void prisma.managementSession.update({where:{id:session.id},data:{lastSeenAt:new Date()}}); next(); } catch(error){ next(error); } }
