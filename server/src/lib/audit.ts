import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export async function logAudit(
  actorId: string,
  action: string,
  opts: { targetType?: string; targetId?: string; meta?: Record<string, unknown> } = {}
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetType: opts.targetType,
      targetId: opts.targetId,
      meta: opts.meta as Prisma.InputJsonValue | undefined,
    },
  });
}
