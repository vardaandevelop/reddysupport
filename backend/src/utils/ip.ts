import type { Request } from "express";
export const requestIp = (req: Request) => req.ip?.slice(0,64) ?? null;
export const requestUserAgent = (req: Request) => req.get("user-agent")?.slice(0,512) ?? null;
