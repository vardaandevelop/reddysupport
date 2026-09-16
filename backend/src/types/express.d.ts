import type { Customer, CustomerSession, User } from "@prisma/client";
declare global { namespace Express { interface Request { management?: { user: User; permissions: string[]; queues: string[]; sessionId: string }; customerAuth?: { customer: Customer; session: CustomerSession } } } }
export {};
