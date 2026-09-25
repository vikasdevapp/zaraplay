import { PrismaClient } from "@prisma/client";

// Sealed card numbers (Transaction.payoutSecret, PayoutMethod.secret) are omitted from every
// query so no route can leak them by returning a whole row; the places that need them opt in.
export const prisma = new PrismaClient({ omit: { transaction: { payoutSecret: true }, payoutMethod: { secret: true } } });
