import { rateLimit } from "express-rate-limit";
const make=(limit:number,minutes:number)=>rateLimit({windowMs:minutes*60_000,limit,standardHeaders:"draft-8",legacyHeaders:false,handler:(_req,res)=>res.status(429).json({success:false,code:"VALIDATION_ERROR",message:"Too many requests. Please try again later.",error:{code:"VALIDATION_ERROR",message:"Too many requests. Please try again later."}})});
export const managementLoginLimit=make(10,15), customerLoginLimit=make(12,15), temporarySessionLimit=make(30,15), messageLimit=make(120,1), uploadLimit=make(20,10), passwordResetLimit=make(5,30);
