import type { NextFunction, Request, Response } from "express";
import { findCustomerSession } from "../services/session.service.js";
import { AppError } from "../utils/errors.js";
import { prisma } from "../config/database.js";
export async function requireCustomerAuth(req:Request,_res:Response,next:NextFunction){ try { const session=await findCustomerSession(req); if(!session) throw new AppError(401,"UNAUTHORIZED","Customer session required"); if(session.customer.status === "BLOCKED") throw new AppError(403,"CUSTOMER_BLOCKED","Customer is blocked"); req.customerAuth={customer:session.customer,session}; void prisma.customerSession.update({where:{id:session.id},data:{lastSeenAt:new Date()}}); next(); } catch(error){next(error);} }
