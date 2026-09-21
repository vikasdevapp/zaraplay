import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

export const gamesRouter = Router();

// Public: shown on the marketing landing page before signup, same as everything below
// requireAuth needs a logged-in session.
gamesRouter.get("/catalog", async (_req, res) => {
  const games = await prisma.game.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  res.json({ games });
});

gamesRouter.use(requireAuth);

gamesRouter.get("/mine", async (req: AuthedRequest, res) => {
  const userGames = await prisma.userGame.findMany({
    where: { userId: req.userId! },
    include: { game: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ userGames });
});

function generateGameId(username: string) {
  return `${username}${crypto.randomBytes(3).toString("hex")}`;
}
function generateGamePassword() {
  return crypto.randomBytes(6).toString("base64url");
}

const addGameSchema = z.object({ gameId: z.string().min(1) });

// Simulates provisioning an account on the third-party game platform.
gamesRouter.post("/mine", async (req: AuthedRequest, res) => {
  const parsed = addGameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid game." });

  const game = await prisma.game.findUnique({ where: { id: parsed.data.gameId } });
  if (!game || !game.isActive) return res.status(404).json({ error: "Game not available." });

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ error: "User not found." });

  const existing = await prisma.userGame.findUnique({
    where: { userId_gameId: { userId: req.userId!, gameId: game.id } },
  });
  if (existing) return res.status(409).json({ error: "You already have this game." });

  const userGame = await prisma.userGame.create({
    data: {
      userId: req.userId!,
      gameId: game.id,
      gameUsername: generateGameId(user.username),
      gamePassword: generateGamePassword(),
    },
    include: { game: true },
  });

  res.status(201).json({ userGame });
});

gamesRouter.post("/mine/:id/reset-password", async (req: AuthedRequest, res) => {
  const userGame = await prisma.userGame.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (!userGame) return res.status(404).json({ error: "Not found." });

  const updated = await prisma.userGame.update({
    where: { id: userGame.id },
    data: { gamePassword: generateGamePassword() },
  });
  res.json({ userGame: updated });
});
