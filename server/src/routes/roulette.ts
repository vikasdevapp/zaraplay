import { Router } from "express";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { AuthedRequest, requireAuth } from "../middleware/auth";

export const rouletteRouter = Router();
rouletteRouter.use(requireAuth);

const ONE_DAY_SECONDS = 24 * 60 * 60;
const spinLockKey = (userId: string) => `roulette:spin:${userId}`;

rouletteRouter.get("/status", async (req: AuthedRequest, res) => {
  const [prizes, ttl, lastSpin] = await Promise.all([
    prisma.roulettePrize.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    redis.ttl(spinLockKey(req.userId!)),
    prisma.rouletteSpin.findFirst({ where: { userId: req.userId! }, orderBy: { createdAt: "desc" } }),
  ]);

  res.json({
    canSpin: ttl <= 0,
    nextAvailableInSeconds: ttl > 0 ? ttl : 0,
    prizes,
    lastSpin,
  });
});

function pickWeightedPrize<T extends { weight: number }>(prizes: T[]): T {
  const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const prize of prizes) {
    roll -= prize.weight;
    if (roll <= 0) return prize;
  }
  return prizes[prizes.length - 1];
}

rouletteRouter.post("/spin", async (req: AuthedRequest, res) => {
  const lockKey = spinLockKey(req.userId!);
  const ttl = await redis.ttl(lockKey);
  if (ttl > 0) {
    return res.status(429).json({ error: "You've already spun today. Come back tomorrow.", nextAvailableInSeconds: ttl });
  }

  const prizes = await prisma.roulettePrize.findMany({ where: { isActive: true } });
  if (prizes.length === 0) return res.status(400).json({ error: "The wheel isn't configured yet." });

  const won = pickWeightedPrize(prizes);

  // Set the lock first: if anything below fails, the spin is still consumed rather than
  // letting a retry win twice.
  await redis.set(lockKey, "1", "EX", ONE_DAY_SECONDS);

  const amount = Number(won.amount);
  const result = await prisma.$transaction(async (tx) => {
    let wallet = await tx.wallet.findUnique({ where: { userId: req.userId! } });
    if (amount > 0) {
      wallet = await tx.wallet.update({ where: { userId: req.userId! }, data: { balance: { increment: amount } } });
      await tx.transaction.create({
        data: {
          userId: req.userId!,
          type: "ROULETTE_WIN",
          amount,
          status: "COMPLETED",
          meta: { prizeId: won.id, prizeLabel: won.label },
        },
      });
    }
    const spin = await tx.rouletteSpin.create({
      data: { userId: req.userId!, prizeLabel: won.label, amount },
    });
    return { wallet, spin };
  });

  res.json({ prize: won, wallet: result.wallet, spin: result.spin });
});
