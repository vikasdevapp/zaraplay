import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma";
import { customAlphabet } from "./lib/nanoid";

const referralCode = customAlphabet();

const GAMES = [
  "Fortune Coins",
  "Golden Reels",
  "Vault Masters",
  "Celestial Stars",
  "Cash Cascade",
  "Diamond Rush",
  "Lucky Dragon",
  "Royal Arcade",
];

const AGENTS = ["Maya Lin", "Jordan Blake", "Priya Nair"];

const VIP_TIERS = [
  { name: "Bronze", emoji: "🥉", colorHex: "#CD7F32", minDeposit: 0, minReferrals: 0, perks: ["Welcome to Zara Plays"], sortOrder: 0 },
  { name: "Silver", emoji: "🥈", colorHex: "#C0C0C0", minDeposit: 100, minReferrals: 0, perks: ["Priority support", "Faster cashout review"], sortOrder: 1 },
  { name: "Gold", emoji: "🥇", colorHex: "#D4AF37", minDeposit: 500, minReferrals: 2, perks: ["10% extra on weekend bonus", "Dedicated agent"], sortOrder: 2 },
  { name: "Platinum", emoji: "💎", colorHex: "#8B5CF6", minDeposit: 2000, minReferrals: 5, perks: ["Highest cashout priority", "Exclusive promos"], sortOrder: 3 },
];

const MARKETPLACE_ITEMS = [
  { name: "Quick Cash", category: "Starter", fpCost: 20, cashValue: 4, sortOrder: 0 },
  { name: "Mini Vault", category: "Starter", fpCost: 50, cashValue: 10, sortOrder: 1 },
  { name: "Lucky Stack", category: "Mid", fpCost: 100, cashValue: 20, sortOrder: 2 },
  { name: "Gold Vault", category: "Mid", fpCost: 200, cashValue: 40, sortOrder: 3 },
  { name: "Royal Vault", category: "High", fpCost: 500, cashValue: 100, sortOrder: 4 },
];

// Weight = relative odds. Higher-value prizes are rarer, matching typical spin-wheel design.
const ROULETTE_PRIZES = [
  { label: "No Reward", amount: 0, weight: 45, colorHex: "#3a3a3a", sortOrder: 0 },
  { label: "$1", amount: 1, weight: 30, colorHex: "#8b5cf6", sortOrder: 1 },
  { label: "$2", amount: 2, weight: 15, colorHex: "#dc2626", sortOrder: 2 },
  { label: "$5", amount: 5, weight: 10, colorHex: "#D4AF37", sortOrder: 3 },
];

async function main() {
  for (let i = 0; i < GAMES.length; i++) {
    const name = GAMES[i];
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    await prisma.game.upsert({
      where: { slug },
      update: { sortOrder: i },
      create: { name, slug, sortOrder: i },
    });
  }

  for (const name of AGENTS) {
    const existing = await prisma.supportAgent.findFirst({ where: { name } });
    if (!existing) await prisma.supportAgent.create({ data: { name } });
  }

  const adminEmail = "admin@zaraplays.local";
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        fullName: "Admin",
        username: "admin",
        email: adminEmail,
        passwordHash: await bcrypt.hash("ChangeMe123!", 10),
        role: "MASTER_ADMIN",
        signupIp: "127.0.0.1",
        referralCode: referralCode(),
        wallet: { create: {} },
      },
    });
    console.log(`Seeded master admin user: ${adminEmail} / ChangeMe123!`);
  }

  const agentEmail = "agent1@zaraplays.local";
  const existingAgent = await prisma.user.findUnique({ where: { email: agentEmail } });
  if (!existingAgent) {
    await prisma.user.create({
      data: {
        fullName: "Agent One",
        username: "agent1",
        email: agentEmail,
        passwordHash: await bcrypt.hash("ChangeMe123!", 10),
        role: "AGENT",
        signupIp: "127.0.0.1",
        referralCode: referralCode(),
      },
    });
    console.log(`Seeded agent user: ${agentEmail} / ChangeMe123!`);
  }

  for (const tier of VIP_TIERS) {
    const existing = await prisma.vipTier.findFirst({ where: { name: tier.name } });
    if (!existing) await prisma.vipTier.create({ data: tier });
  }

  for (const item of MARKETPLACE_ITEMS) {
    const existing = await prisma.marketplaceItem.findFirst({ where: { name: item.name } });
    if (!existing) await prisma.marketplaceItem.create({ data: item });
  }

  for (const prize of ROULETTE_PRIZES) {
    const existing = await prisma.roulettePrize.findFirst({ where: { label: prize.label } });
    if (!existing) await prisma.roulettePrize.create({ data: prize });
  }

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
