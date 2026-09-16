import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
export type ErrorCode = "UNAUTHORIZED"|"FORBIDDEN"|"SESSION_EXPIRED"|"VALIDATION_ERROR"|"USERNAME_EXISTS"|"CUSTOMER_NOT_FOUND"|"CUSTOMER_ALREADY_RECURRING"|"CUSTOMER_BLOCKED"|"STAFF_NOT_ALLOWED_FOR_QUEUE"|"MESSAGE_SEND_FAILED"|"UPLOAD_FAILED"|"SERVER_ERROR";
export class AppError extends Error { constructor(public status: number, public code: ErrorCode, message: string, public details?: unknown) { super(message); } }
export const notFound = () => { throw new AppError(404, "CUSTOMER_NOT_FOUND", "Resource not found"); };
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) return res.status(400).json({ success:false, code:"VALIDATION_ERROR", message:"Invalid request", error:{ code:"VALIDATION_ERROR", message:"Invalid request" }, details:error.flatten() });
  if (error instanceof AppError) return res.status(error.status).json({ success:false, code:error.code, message:error.message, error:{ code:error.code, message:error.message }, ...(error.details ? { details:error.details } : {}) });
  console.error("Unhandled request error", error);
  return res.status(500).json({ success:false, code:"SERVER_ERROR", message:"An unexpected error occurred", error:{ code:"SERVER_ERROR", message:"An unexpected error occurred" } });
}
