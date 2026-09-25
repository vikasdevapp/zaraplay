import { PrismaClient } from "@prisma/client";

// payoutSecret (sealed card numbers) is omitted from every query so no route can leak it by
// returning a whole Transaction row; the one place that needs it opts in explicitly.
export const prisma = new PrismaClient({ omit: { transaction: { payoutSecret: true } } });
