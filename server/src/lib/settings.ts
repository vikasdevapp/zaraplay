import { prisma } from "./prisma";

export async function getPlatformSettings() {
  return prisma.platformSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

export type PlatformSettings = Awaited<ReturnType<typeof getPlatformSettings>>;
