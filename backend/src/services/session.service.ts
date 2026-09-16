import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { prisma } from "../config/database.js";
import { createToken, hashToken } from "../utils/tokens.js";
import { requestIp, requestUserAgent } from "../utils/ip.js";
const msDay = 86_400_000;
const cookieOptions = (days:number) => ({ httpOnly:true, secure:env.NODE_ENV === "production", sameSite:(env.NODE_ENV === "production" ? "none" : "lax") as "none"|"lax", path:"/", maxAge:days*msDay });
export async function createManagementSession(userId:string, req:Request, res:Response) {
  const token=createToken(), expiresAt=new Date(Date.now()+env.SESSION_DAYS*msDay);
  await prisma.managementSession.create({data:{userId,tokenHash:hashToken(token),ipAddress:requestIp(req),userAgent:requestUserAgent(req),expiresAt}});
  res.cookie(env.MANAGEMENT_COOKIE_NAME,token,cookieOptions(env.SESSION_DAYS));
}
export async function createCustomerSession(customerId:string,type:"TEMPORARY"|"AUTHENTICATED",req:Request,res:Response,meta?:{device?:string;browser?:string;rememberDevice?:boolean}) {
  const days=type === "TEMPORARY" ? env.TEMP_CUSTOMER_SESSION_DAYS : (meta?.rememberDevice === false ? 1 : env.SESSION_DAYS);
  const token=createToken(), expiresAt=new Date(Date.now()+days*msDay);
  const session=await prisma.customerSession.create({data:{customerId,tokenHash:hashToken(token),sessionType:type,deviceName:meta?.device?.slice(0,120),browser:meta?.browser?.slice(0,120),ipAddress:requestIp(req),userAgent:requestUserAgent(req),expiresAt}});
  res.cookie(env.CUSTOMER_COOKIE_NAME,token,cookieOptions(days)); return session;
}
export async function revokeManagementSession(req:Request,res:Response){ const token=req.cookies?.[env.MANAGEMENT_COOKIE_NAME] as string|undefined; if(token) await prisma.managementSession.updateMany({where:{tokenHash:hashToken(token),revokedAt:null},data:{revokedAt:new Date()}}); res.clearCookie(env.MANAGEMENT_COOKIE_NAME,{path:"/"}); }
export async function revokeCustomerSession(req:Request,res:Response){ const token=req.cookies?.[env.CUSTOMER_COOKIE_NAME] as string|undefined; if(token) await prisma.customerSession.updateMany({where:{tokenHash:hashToken(token),revokedAt:null},data:{revokedAt:new Date()}}); res.clearCookie(env.CUSTOMER_COOKIE_NAME,{path:"/"}); }
export async function findManagementSession(req:Request){ const token=req.cookies?.[env.MANAGEMENT_COOKIE_NAME] as string|undefined; if(!token)return null; return prisma.managementSession.findFirst({where:{tokenHash:hashToken(token),revokedAt:null,expiresAt:{gt:new Date()},user:{active:true}},include:{user:{include:{permissions:{include:{permission:true}},queueAccess:true}}}}); }
export async function findCustomerSession(req:Request){ const token=req.cookies?.[env.CUSTOMER_COOKIE_NAME] as string|undefined; if(!token)return null; return prisma.customerSession.findFirst({where:{tokenHash:hashToken(token),revokedAt:null,expiresAt:{gt:new Date()}},include:{customer:true}}); }
