import { Router } from "express";
import { prisma } from "../../lib/prisma";

export const adminPlayerAnalyticsRouter = Router();

interface PlayerRow {
  id: string;
  fullName: string;
  username: string;
  email: string;
  createdAt: Date;
  totalDeposited: string;
  totalPayout: string;
  gameBalance: string;
  referralCount: bigint;
  hasDeposited: boolean;
  freePlay: string;
  lastActivityAt: Date | null;
}

adminPlayerAnalyticsRouter.get("/", async (_req, res) => {
  const rows = await prisma.$queryRaw<PlayerRow[]>`
    SELECT
      u.id, u."fullName", u.username, u.email, u."createdAt",
      COALESCE(dep.total, 0) AS "totalDeposited",
      COALESCE(payout.total, 0) AS "totalPayout",
      COALESCE(gb.total, 0) AS "gameBalance",
      COALESCE(ref.count, 0) AS "referralCount",
      COALESCE(w."hasDeposited", false) AS "hasDeposited",
      COALESCE(w."freePlay", 0) AS "freePlay",
      lasttx."lastAt" AS "lastActivityAt"
    FROM "User" u
    LEFT JOIN "Wallet" w ON w."userId" = u.id
    LEFT JOIN (SELECT "userId", SUM(amount) AS total FROM "Transaction" WHERE type = 'DEPOSIT' GROUP BY "userId") dep ON dep."userId" = u.id
    LEFT JOIN (SELECT "userId", SUM("payoutAmount") AS total FROM "Transaction" WHERE type = 'CASHOUT' AND status = 'COMPLETED' GROUP BY "userId") payout ON payout."userId" = u.id
    LEFT JOIN (SELECT "userId", SUM(balance) AS total FROM "UserGame" GROUP BY "userId") gb ON gb."userId" = u.id
    LEFT JOIN (SELECT "referredById" AS "userId", COUNT(*) AS count FROM "User" WHERE "referredById" IS NOT NULL GROUP BY "referredById") ref ON ref."userId" = u.id
    LEFT JOIN (SELECT "userId", MAX("createdAt") AS "lastAt" FROM "Transaction" GROUP BY "userId") lasttx ON lasttx."userId" = u.id
    WHERE u.role = 'USER'
  `;

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const players = rows.map((r) => {
    const totalDeposited = Number(r.totalDeposited);
    const totalPayout = Number(r.totalPayout);
    const net = totalDeposited - totalPayout;
    const lastActivityAt = r.lastActivityAt ? new Date(r.lastActivityAt) : null;
    return {
      id: r.id,
      fullName: r.fullName,
      username: r.username,
      email: r.email,
      createdAt: r.createdAt,
      totalDeposited,
      totalPayout,
      net,
      gameBalance: Number(r.gameBalance),
      referralCount: Number(r.referralCount),
      hasDeposited: r.hasDeposited,
      freePlay: Number(r.freePlay),
      lastActivityAt,
      daysSinceActivity: lastActivityAt ? Math.floor((now - lastActivityAt.getTime()) / DAY) : null,
      daysSinceSignup: Math.floor((now - new Date(r.createdAt).getTime()) / DAY),
    };
  });

  const top = <T>(arr: T[], n = 20) => arr.slice(0, n);
  const byNetDesc = [...players].sort((a, b) => b.net - a.net);
  const byNetAsc = [...players].sort((a, b) => a.net - b.net).filter((p) => p.net < 0);

  const segments = {
    profitPlayers: top(byNetDesc.filter((p) => p.net > 0)),
    riskPlayers: top(byNetAsc),
    heavyDepositors: top([...players].sort((a, b) => b.totalDeposited - a.totalDeposited).filter((p) => p.totalDeposited > 0)),
    gameLoaders: top([...players].sort((a, b) => b.gameBalance - a.gameBalance).filter((p) => p.gameBalance > 0)),
    bigRedeemers: top([...players].sort((a, b) => b.totalPayout - a.totalPayout).filter((p) => p.totalPayout > 0)),
    fpOnlyPlayers: top(players.filter((p) => !p.hasDeposited && p.freePlay > 0)),
    newSignups: top(players.filter((p) => p.daysSinceSignup <= 7).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())),
    activePlayers: top(players.filter((p) => p.daysSinceActivity !== null && p.daysSinceActivity <= 7)),
    referralLeaders: top([...players].sort((a, b) => b.referralCount - a.referralCount).filter((p) => p.referralCount > 0)),
    riskWatch: top(players.filter((p) => p.totalDeposited > 0 && p.totalPayout / p.totalDeposited > 0.8)),
    inactiveCold: top(
      players.filter((p) => p.hasDeposited && (p.daysSinceActivity === null || p.daysSinceActivity > 30))
    ),
  };

  res.json({
    summary: {
      totalPlayers: players.length,
      newSignups: segments.newSignups.length,
      activePlayers: segments.activePlayers.length,
      depositors: players.filter((p) => p.hasDeposited).length,
      fpOnly: segments.fpOnlyPlayers.length,
      estProfit: players.reduce((sum, p) => sum + p.net, 0),
    },
    segments,
  });
});
